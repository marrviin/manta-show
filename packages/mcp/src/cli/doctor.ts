import fs from 'node:fs';
import { homedir } from 'node:os';
import * as p from '@clack/prompts';
import { t } from '../i18n/index.js';
import { locateFfmpeg } from '../deps/ffmpeg.js';
import { runFfmpeg } from '../pipeline/encode.js';
import { getBrowser } from '../targets/browser.js';
import { mediaPath, outputDir } from '../util/media.js';
import {
  entriesMatch,
  listAgentStatuses,
  mcpCommand,
  repairMcpConfigs,
  runInit,
  type McpEntry,
} from './init.js';
import {
  checkChromium,
  checkContainer,
  checkFfmpeg,
  renderReports,
  runFixLoop,
  type CheckReport,
} from './deps.js';
import { printBanner } from './banner.js';

function checkNode(): CheckReport {
  const major = Number(process.versions.node.split('.')[0]);
  return {
    group: t('doctor.group.deps'),
    name: t('doctor.name.node'),
    ok: major >= 20,
    summary: t('doctor.node.summary', { version: process.versions.node }),
    hint: t('doctor.node.hint'),
  };
}

function checkOutputDir(): CheckReport {
  const dir = outputDir().replace(homedir(), '~'); // outputDir() also creates the directory as a side effect
  try {
    fs.accessSync(outputDir(), fs.constants.W_OK);
    return { group: t('doctor.group.output'), name: t('doctor.name.outputDir'), ok: true, summary: t('doctor.outputDir.writable', { dir }) };
  } catch (e) {
    return {
      group: t('doctor.group.output'),
      name: t('doctor.name.outputDir'),
      ok: false,
      summary: t('doctor.outputDir.notWritable', { dir, message: e instanceof Error ? e.message : String(e) }),
      hint: t('doctor.outputDir.hint'),
    };
  }
}

function checkMcp(): CheckReport {
  const statuses = listAgentStatuses();
  const detected = statuses.filter((s) => s.detected);
  if (detected.length === 0) {
    return {
      group: t('doctor.group.output'),
      name: t('doctor.name.mcpConfig'),
      ok: true,
      summary: t('doctor.mcp.none'),
    };
  }

  const standard = mcpCommand();
  // In source-run mode (no dist) the standard is a PATH fallback; rewriting to it could break a
  // working config, so mismatches are reported but not counted as fixable issues
  const comparable = standard.real;
  const okAgents = detected.filter(
    (s) => s.entryState.state === 'ok' && (!comparable || entriesMatch(s.entry!, standard)),
  );
  const stale = comparable
    ? detected.filter((s) => s.entryState.state === 'ok' && !entriesMatch(s.entry!, standard))
    : [];
  const malformed = detected.filter((s) => s.entryState.state === 'malformed');
  const missing = detected.filter((s) => s.entryState.state === 'missing');
  const parseFailed = detected.filter((s) => s.entryState.state === 'parse-error');

  const fmtCmd = (entry: McpEntry) =>
    [entry.command.replace(homedir(), '~'), ...entry.args.map((a) => a.replace(homedir(), '~'))].join(' ');

  const hintParts: string[] = [
    ...stale.map((s) =>
      t('doctor.mcp.staleHint', {
        agent: s.name,
        actual: fmtCmd(s.entry!),
        expected: fmtCmd({ command: standard.command, args: standard.args }),
      }),
    ),
    ...parseFailed.map((s) => t('doctor.mcp.brokenHint', { agent: s.name, path: s.configPath })),
  ];
  const hint = hintParts.length ? hintParts.join('; ') : undefined;

  const summaryParts: string[] = [];
  if (okAgents.length) {
    summaryParts.push(t('doctor.mcp.configured', { names: okAgents.map((s) => s.name).join(', ') }));
  } else {
    summaryParts.push(t('doctor.mcp.noneConfigured'));
  }
  if (stale.length) summaryParts.push(t('doctor.mcp.mismatch', { names: stale.map((s) => s.name).join(', ') }));
  if (malformed.length) summaryParts.push(t('doctor.mcp.mismatch', { names: malformed.map((s) => s.name).join(', ') }));
  if (missing.length) summaryParts.push(t('doctor.mcp.missing', { names: missing.map((s) => s.name).join(', ') }));
  if (parseFailed.length) summaryParts.push(t('doctor.mcp.broken', { names: parseFailed.map((s) => s.name).join(', ') }));

  const brokenFixable = stale.length + malformed.length > 0;
  const missingFixable = missing.length > 0;
  return {
    group: t('doctor.group.output'),
    name: t('doctor.name.mcpConfig'),
    ok: okAgents.length === detected.length,
    summary: summaryParts.join(''),
    hint,
    fix:
      brokenFixable || missingFixable
        ? {
            desc:
              brokenFixable && missingFixable
                ? t('doctor.mcp.fixDescBoth')
                : brokenFixable
                  ? t('doctor.mcp.repairDesc')
                  : t('doctor.mcp.fixDesc'),
            run: async () => {
              const current = listAgentStatuses().filter((s) => s.detected);
              if (brokenFixable) await repairMcpConfigs(current);
              if (missingFixable) await runInit();
            },
          }
        : undefined,
  };
}

const DEEP_GROUP = t('doctor.group.pipeline');

/** End-to-end screenshot test: launch Chromium, render a built-in page, save to the real output dir */
async function deepScreenshot(): Promise<CheckReport> {
  const name = t('doctor.name.screenshotPipeline');
  const file = mediaPath('deep-check', 'png');
  try {
    const browser = await getBrowser();
    const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
    try {
      await page.setContent(
        '<body style="margin:0;display:grid;place-items:center;height:100vh;background:#111;color:#fff;font:600 40px sans-serif">manta-show</body>',
      );
      await page.screenshot({ path: file });
    } finally {
      await page.close();
    }
    if (!fs.existsSync(file) || fs.statSync(file).size === 0) {
      return { group: DEEP_GROUP, name, ok: false, summary: t('doctor.screenshot.empty') };
    }
    return { group: DEEP_GROUP, name, ok: true, summary: t('doctor.screenshot.ok') };
  } catch (e) {
    return {
      group: DEEP_GROUP,
      name,
      ok: false,
      summary: e instanceof Error ? e.message : String(e),
    };
  } finally {
    fs.rmSync(file, { force: true });
  }
}

/** End-to-end video test: encode a synthetic 1s clip with the same ffmpeg the capture pipeline uses */
async function deepVideo(): Promise<CheckReport> {
  const name = t('doctor.name.videoPipeline');
  const file = mediaPath('deep-check', 'mp4');
  try {
    const bin = await locateFfmpeg();
    if (!bin) {
      return { group: DEEP_GROUP, name, ok: false, summary: t('doctor.video.skip') };
    }
    await runFfmpeg([
      '-f', 'lavfi', '-i', 'testsrc=duration=1:size=320x180:rate=30',
      '-pix_fmt', 'yuv420p', '-y', file,
    ]);
    if (!fs.existsSync(file) || fs.statSync(file).size === 0) {
      return { group: DEEP_GROUP, name, ok: false, summary: t('doctor.video.empty') };
    }
    return {
      group: DEEP_GROUP,
      name,
      ok: true,
      summary: t('doctor.video.ok', {
        source: bin.source === 'path' ? 'PATH' : t('doctor.video.source.localBinary'),
      }),
    };
  } catch (e) {
    return {
      group: DEEP_GROUP,
      name,
      ok: false,
      summary: e instanceof Error ? e.message : String(e),
      hint: t('doctor.video.hint'),
    };
  } finally {
    fs.rmSync(file, { force: true });
  }
}

export async function runDoctor(args: string[] = []): Promise<void> {
  printBanner();
  const deep = args.includes('--deep');
  p.intro(deep ? t('doctor.intro.deep') : t('doctor.intro'));

  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);

  // Run checks one by one, refreshing the spinner text so the loading animation is visible
  const items: Array<[string, () => CheckReport | Promise<CheckReport>]> = [
    [t('doctor.name.node'), checkNode],
    [t('doctor.name.ffmpeg'), checkFfmpeg],
    [t('doctor.name.chromium'), checkChromium],
    [t('doctor.name.container'), checkContainer],
    [t('doctor.name.outputDir'), checkOutputDir],
    [t('doctor.name.mcpConfig'), checkMcp],
  ];
  const spinner = p.spinner();
  if (interactive) spinner.start(t('doctor.checking'));
  const reports: CheckReport[] = [];
  for (const [name, check] of items) {
    if (interactive) {
      spinner.message(t('doctor.checkingItem', { name }));
      // The checks themselves are fast (all <100ms); a small pause makes the per-item progress visible
      await new Promise((r) => setTimeout(r, 250));
    }
    reports.push(await check());
  }

  // --deep: real end-to-end capture, verifying the pipeline rather than just the dependencies
  if (deep) {
    const chromiumOk = reports.find((r) => r.name === t('doctor.name.chromium'))?.ok ?? false;
    if (interactive) spinner.message(t('doctor.deepTesting'));
    if (chromiumOk) {
      reports.push(await deepScreenshot());
    } else {
      reports.push({
        group: DEEP_GROUP,
        name: t('doctor.name.screenshotPipeline'),
        ok: false,
        summary: t('doctor.screenshot.skipNoChromium'),
      });
    }
    reports.push(await deepVideo());
  }

  // Optional misses (e.g. container runtime) are acceptable and not counted as issues
  const issues = reports.filter((r) => !r.ok && !r.optional);
  if (interactive) {
    spinner.stop(issues.length === 0 ? t('doctor.done') : t('doctor.doneIssues', { count: issues.length }));
  }

  renderReports(reports);

  if (issues.length === 0) {
    p.outro(t('doctor.allGood'));
    return;
  }

  await runFixLoop(reports, interactive);

  p.outro(t('doctor.rerun'));
}
