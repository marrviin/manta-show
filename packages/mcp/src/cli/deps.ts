import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { homedir } from 'node:os';
import * as p from '@clack/prompts';
import { t } from '../i18n/index.js';
import { chromium } from 'playwright';
import { downloadBundledFfmpeg, locateFfmpeg, type FfmpegSource } from '../deps/ffmpeg.js';
import { detectContainerRuntime } from '../deps/container.js';

export interface Fix {
  desc: string;
  /** `report` streams progress text for the spinner while the fix runs */
  run: (report?: (msg: string) => void) => void | Promise<void>;
}

export interface CheckReport {
  /** Group title: environment dependencies / output & integration */
  group: string;
  name: string;
  ok: boolean;
  /** One-line summary for aligned display (no long paths) */
  summary: string;
  /** Manual suggestion on failure, shown under the corresponding entry */
  hint?: string;
  /** Automatic fix, run after the user confirms */
  fix?: Fix;
  /** Missing is acceptable: shown with ○ instead of ✗ and never counted as an issue */
  optional?: boolean;
}

/** What a missing dependency costs to download, shown in the init confirm so the user can decide informed */
function downloadHint(name: string): string {
  switch (name) {
    case 'Chromium':
      return t('deps.downloadHints.chromium');
    case 'ffmpeg':
      return t('deps.downloadHints.ffmpeg');
    default:
      return t('deps.downloadHints.default');
  }
}

/** Progress-reporting throttle: playwright redraws its bar many times per second */
function throttled(report: (msg: string) => void, minIntervalMs = 120): (msg: string) => void {
  let last = 0;
  return (msg) => {
    const now = Date.now();
    if (now - last < minIntervalMs) return;
    last = now;
    report(msg);
  };
}

/**
 * Install Chromium through the playwright CLI bundled inside this package (no npx / PATH
 * dependency). Defaults PLAYWRIGHT_DOWNLOAD_HOST to the npmmirror binary mirror — consistent
 * with the ffmpeg fallback — unless the user already configured one.
 */
export async function installChromium(report?: (msg: string) => void): Promise<void> {
  const require = createRequire(import.meta.url);
  const cli = path.join(path.dirname(require.resolve('playwright/package.json')), 'cli.js');
  const env = {
    ...process.env,
    PLAYWRIGHT_DOWNLOAD_HOST:
      process.env.PLAYWRIGHT_DOWNLOAD_HOST || 'https://cdn.npmmirror.com/binaries/playwright',
  };
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [cli, 'install', 'chromium'], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const onChunk = (d: Buffer): void => {
      if (!report) return;
      const text = d.toString();
      // playwright redraws a progress bar like "| 34.2/170 MiB"; stage lines start with "Downloading"
      const bar = /(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)\s*(MiB|MB)/.exec(text);
      if (bar) {
        report(t('deps.progress.download', { received: bar[1], total: bar[2], unit: bar[3] }));
      } else {
        const stage = /Downloading ([^\r\n]+)/.exec(text);
        if (stage) report(stage[1].trim().slice(0, 70));
      }
    };
    child.stdout.on('data', onChunk);
    child.stderr.on('data', onChunk);
    child.on('error', (e) => reject(new Error(t('deps.installer.spawnFail', { message: e.message }))));
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(t('deps.installer.exitCode', { code: code ?? -1 })));
    });
  });
}

/** Display label per ffmpeg resolution source; kept in sync with resolveFfmpeg's probe order */
const FFMPEG_SOURCE_LABELS: Record<FfmpegSource, string> = {
  env: 'MANTA_SHOW_FFMPEG',
  path: 'PATH',
  'well-known': t('deps.ffmpegSource.wellKnown'),
  managed: t('deps.ffmpegSource.managed'),
  bundled: t('deps.ffmpegSource.bundled', {
    platform: process.platform,
    arch: process.arch,
  }),
};

const fmtMiB = (bytes: number): string => `${(bytes / 1048576).toFixed(1)} MB`;

export async function checkFfmpeg(): Promise<CheckReport> {
  const found = await locateFfmpeg();
  if (found) {
    return { group: t('doctor.group.deps'), name: t('doctor.name.ffmpeg'), ok: true, summary: FFMPEG_SOURCE_LABELS[found.source] };
  }
  return {
    group: t('doctor.group.deps'),
    name: t('doctor.name.ffmpeg'),
    ok: false,
    summary: t('deps.ffmpeg.notFound'),
    hint: t('deps.ffmpeg.hint'),
    fix: {
      desc: t('deps.ffmpeg.fixDesc'),
      run: async (report) => {
        await downloadBundledFfmpeg(
          report &&
            ((received, total) =>
              report(
                total
                  ? t('deps.progress.downloading', { received: fmtMiB(received), total: fmtMiB(total) })
                  : t('deps.progress.downloaded', { received: fmtMiB(received) }),
              )),
        );
      },
    },
  };
}

export async function checkChromium(): Promise<CheckReport> {
  let exe = '';
  try {
    exe = chromium.executablePath();
  } catch {
    // Treat a registry failure as not installed
  }
  if (exe && fs.existsSync(exe)) {
    const version = /chromium-\d+/.exec(exe)?.[0] ?? t('deps.chromium.installedFallback');
    return { group: t('doctor.group.deps'), name: t('doctor.name.chromium'), ok: true, summary: version };
  }
  return {
    group: t('doctor.group.deps'),
    name: t('doctor.name.chromium'),
    ok: false,
    summary: t('deps.chromium.notInstalled'),
    fix: {
      desc: t('deps.chromium.fixDesc'),
      run: (report) => installChromium(report),
    },
  };
}

export async function checkContainer(): Promise<CheckReport> {
  const detected = await detectContainerRuntime();
  if (detected) {
    return {
      group: t('doctor.group.deps'),
      name: t('doctor.name.container'),
      ok: true,
      summary: t('deps.container.summary', {
        runtime: detected.runtime,
        bin: detected.bin === detected.runtime ? t('deps.container.pathLabel') : detected.bin.replace(homedir(), '~'),
      }),
    };
  }
  return {
    group: t('doctor.group.deps'),
    name: t('doctor.name.container'),
    ok: false,
    optional: true,
    summary: t('deps.container.notInstalled'),
    hint: t('deps.container.hint'),
  };
}

/** Full-width characters (e.g. CJK) count as 2 columns, for result table alignment */
function displayWidth(s: string): number {
  let width = 0;
  for (const ch of s) width += (ch.codePointAt(0) ?? 0) > 0x2e80 ? 2 : 1;
  return width;
}

function pad(s: string, width: number): string {
  return s + ' '.repeat(Math.max(0, width - displayWidth(s)));
}

/** Render the result table by group: group header + aligned names + ✓/✗/○, with manual suggestions under failed entries */
export function renderReports(reports: CheckReport[]): void {
  const groups = [...new Set(reports.map((r) => r.group))];
  const nameWidth = Math.max(...reports.map((r) => displayWidth(r.name))) + 2;
  for (const group of groups) {
    p.log.step(group);
    const lines: string[] = [];
    for (const report of reports.filter((r) => r.group === group)) {
      const mark = report.ok ? '✓' : report.optional ? '○' : '✗';
      lines.push(`${mark} ${pad(report.name, nameWidth)}${report.summary}`);
      if (!report.ok && report.hint) lines.push(`  ${report.hint}`);
    }
    p.log.message(lines.join('\n'));
  }
}

/**
 * Confirm-and-run the automatic fixes attached to failed reports (with progress on the spinner).
 * Shared by doctor; skips prompting entirely outside a TTY.
 */
export async function runFixLoop(
  reports: CheckReport[],
  interactive: boolean,
): Promise<void> {
  const fixable = reports.filter((r) => !r.ok && r.fix);
  if (fixable.length === 0) return;
  if (!interactive) {
    p.log.warn(t('deps.fix.nonInteractive'));
    return;
  }
  for (const issue of fixable) {
    const answer = await p.confirm({
      message: t('deps.fix.confirm', { name: issue.name, desc: issue.fix!.desc }),
    });
    if (p.isCancel(answer)) {
      p.cancel(t('deps.fix.cancelled'));
      process.exit(0);
    }
    if (!answer) {
      p.log.step(t('deps.fix.skipped', { name: issue.name }));
      continue;
    }
    const fixSpinner = p.spinner();
    fixSpinner.start(t('deps.fix.running', { desc: issue.fix!.desc }));
    try {
      await issue.fix!.run((msg) => fixSpinner.message(msg));
      fixSpinner.stop(t('deps.fix.done'));
    } catch (e) {
      fixSpinner.stop(t('deps.fix.failed', { message: e instanceof Error ? e.message : String(e) }));
    }
  }
}

/**
 * init's environment-preparation stage (the last onboarding step): detect → list everything to
 * download with sizes and confirm once → install item by item with progress → re-check → summarize.
 * The user completes all download configuration here and never needs to touch doctor again.
 */
export async function runEnvironmentSetup(): Promise<void> {
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const reports = [await checkChromium(), await checkFfmpeg(), await checkContainer()];
  renderReports(reports);

  const missing = reports.filter((r) => !r.ok && !r.optional);
  const optional = reports.filter((r) => !r.ok && r.optional);

  if (missing.length === 0) {
    p.log.success(t('deps.setup.complete'));
  } else {
    const plan = missing.map((r) => `${r.name} (${downloadHint(r.name)})`).join(', ');
    let proceed = false;
    if (interactive) {
      const answer = await p.confirm({ message: t('deps.setup.confirm', { plan }) });
      if (p.isCancel(answer)) {
        p.log.info(t('deps.setup.skipped'));
      } else {
        proceed = Boolean(answer);
      }
    } else {
      p.log.warn(t('deps.setup.warnNonInteractive'));
    }

    if (proceed) {
      const installed: string[] = [];
      for (const item of missing) {
        const spinner = p.spinner();
        spinner.start(t('deps.setup.installing', { name: item.name }));
        try {
          const report = throttled((msg) => spinner.message(t('deps.setup.itemProgress', { name: item.name, msg })));
          if (item.name === 'Chromium') {
            await installChromium(report);
          } else if (item.name === 'ffmpeg') {
            await downloadBundledFfmpeg((received, total) =>
              report(
                total
                  ? t('deps.progress.downloading', { received: fmtMiB(received), total: fmtMiB(total) })
                  : t('deps.progress.downloaded', { received: fmtMiB(received) }),
              ),
            );
          } else {
            continue;
          }
          spinner.stop(t('deps.setup.installed', { name: item.name }));
          installed.push(item.name);
        } catch (e) {
          spinner.stop(t('deps.setup.installFailed', { name: item.name, message: e instanceof Error ? e.message : String(e) }));
        }
      }
      if (installed.length > 0) {
        const rechecked = [await checkChromium(), await checkFfmpeg()];
        renderReports(rechecked);
        const still = rechecked.filter((r) => !r.ok && !r.optional);
        p.log.success(still.length === 0 ? t('deps.setup.ready') : t('deps.setup.stillMissing'));
      }
    }
  }

  for (const item of optional) {
    if (item.hint) p.log.info(item.hint);
  }
}
