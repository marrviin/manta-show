import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import * as p from '@clack/prompts';
import { chromium } from 'playwright';
import { locateFfmpeg, runFfmpeg } from '../capture/ffmpeg.js';
import { getBrowser } from '../capture/browser.js';
import { mediaPath, outputDir } from '../util/media.js';
import { listAgentStatuses, runInit } from './init.js';
import { printBanner } from './banner.js';

interface Fix {
  desc: string;
  run: () => void;
}

interface CheckReport {
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
}

function whichSync(bin: string): boolean {
  return (process.env.PATH ?? '')
    .split(path.delimiter)
    .some((dir) => dir && fs.existsSync(path.join(dir, bin)));
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

function checkNode(): CheckReport {
  const major = Number(process.versions.node.split('.')[0]);
  return {
    group: '环境依赖',
    name: 'Node.js',
    ok: major >= 20,
    summary: `v${process.versions.node}（要求 >= 20）`,
    hint: '请升级 Node.js（如 nvm install 20 && nvm use 20）后重装 manta-show',
  };
}

async function checkFfmpeg(): Promise<CheckReport> {
  const bin = await locateFfmpeg();
  if (bin) {
    const summary =
      bin === 'ffmpeg'
        ? 'PATH'
        : process.env.MANTA_SHOW_FFMPEG === bin
          ? 'MANTA_SHOW_FFMPEG'
          : 'ffmpeg-static（依赖自带）';
    return { group: '环境依赖', name: 'ffmpeg', ok: true, summary };
  }
  const hasBrew = whichSync('brew');
  return {
    group: '环境依赖',
    name: 'ffmpeg',
    ok: false,
    summary: '未找到 —— 终端录制合成 mp4 需要',
    hint: hasBrew ? undefined : '未检测到 brew，请手动安装 ffmpeg 或设置 MANTA_SHOW_FFMPEG',
    fix: hasBrew
      ? {
          desc: 'brew install ffmpeg',
          run: () => {
            spawnSync('brew', ['install', 'ffmpeg'], { stdio: 'inherit' });
          },
        }
      : undefined,
  };
}

async function checkChromium(): Promise<CheckReport> {
  let exe = '';
  try {
    exe = chromium.executablePath();
  } catch {
    // Treat a registry failure as not installed
  }
  if (exe && fs.existsSync(exe)) {
    const version = /chromium-\d+/.exec(exe)?.[0] ?? '已安装';
    return { group: '环境依赖', name: 'Chromium', ok: true, summary: version };
  }
  return {
    group: '环境依赖',
    name: 'Chromium',
    ok: false,
    summary: '未安装 —— 浏览器 / 终端回放页 / Electron 采集都需要',
    fix: {
      desc: 'npx playwright install chromium',
      run: () => {
        const result = spawnSync('npx', ['playwright', 'install', 'chromium'], {
          stdio: 'inherit',
        });
        if (result.status !== 0) {
          p.log.error('chromium 安装失败，请手动运行 npx playwright install chromium');
        }
      },
    },
  };
}

function checkOutputDir(): CheckReport {
  const dir = process.env.MANTA_SHOW_OUTPUT
    ? outputDir()
    : outputDir().replace(homedir(), '~'); // outputDir() also creates the directory as a side effect
  try {
    fs.accessSync(outputDir(), fs.constants.W_OK);
    return { group: '输出与接入', name: '输出目录', ok: true, summary: `${dir} 可写` };
  } catch (e) {
    return {
      group: '输出与接入',
      name: '输出目录',
      ok: false,
      summary: `${dir} 不可写（${e instanceof Error ? e.message : String(e)}）`,
      hint: '检查 MANTA_SHOW_OUTPUT 指向或目录权限',
    };
  }
}

function checkMcp(): CheckReport {
  const statuses = listAgentStatuses();
  const detected = statuses.filter((s) => s.detected);
  if (detected.length === 0) {
    return {
      group: '输出与接入',
      name: 'MCP 配置',
      ok: true,
      summary: '未检测到已安装的 AI Agent（安装后运行 manta-show init 即可接入）',
    };
  }
  const configured = detected.filter((s) => s.configured).map((s) => s.name);
  const missing = detected.filter((s) => !s.configured).map((s) => s.name);
  return {
    group: '输出与接入',
    name: 'MCP 配置',
    ok: missing.length === 0,
    summary:
      (configured.length ? `已配置：${configured.join('、')}` : '尚无已配置的 Agent') +
      (missing.length ? `；未配置：${missing.join('、')}` : ''),
    fix:
      missing.length > 0
        ? {
            desc: 'manta-show init（写入缺失的 MCP 配置）',
            run: () => runInit(),
          }
        : undefined,
  };
}

const DEEP_GROUP = '采集管线';

/** End-to-end screenshot test: launch Chromium, render a built-in page, save to the real output dir */
async function deepScreenshot(): Promise<CheckReport> {
  const name = '截图管线';
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
      return { group: DEEP_GROUP, name, ok: false, summary: '截图文件为空' };
    }
    return { group: DEEP_GROUP, name, ok: true, summary: 'Chromium 渲染 + 截图正常' };
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
  const name = '视频管线';
  const file = mediaPath('deep-check', 'mp4');
  try {
    const bin = await locateFfmpeg();
    if (!bin) {
      return { group: DEEP_GROUP, name, ok: false, summary: '已跳过 —— 未找到 ffmpeg' };
    }
    await runFfmpeg([
      '-f', 'lavfi', '-i', 'testsrc=duration=1:size=320x180:rate=30',
      '-pix_fmt', 'yuv420p', '-y', file,
    ]);
    if (!fs.existsSync(file) || fs.statSync(file).size === 0) {
      return { group: DEEP_GROUP, name, ok: false, summary: '编码产物为空' };
    }
    return { group: DEEP_GROUP, name, ok: true, summary: `ffmpeg 编码正常（${bin === 'ffmpeg' ? 'PATH' : '本地二进制'}）` };
  } catch (e) {
    return {
      group: DEEP_GROUP,
      name,
      ok: false,
      summary: e instanceof Error ? e.message : String(e),
      hint: '终端录制合成 mp4 依赖 ffmpeg，请检查安装或 MANTA_SHOW_FFMPEG 设置',
    };
  } finally {
    fs.rmSync(file, { force: true });
  }
}

/** Render the result table by group: group header + aligned names + ✓/✗, with manual suggestions under failed entries */
function renderReports(reports: CheckReport[]): void {
  const groups = [...new Set(reports.map((r) => r.group))];
  const nameWidth = Math.max(...reports.map((r) => displayWidth(r.name))) + 2;
  for (const group of groups) {
    p.log.step(group);
    const lines: string[] = [];
    for (const report of reports.filter((r) => r.group === group)) {
      lines.push(`${report.ok ? '✓' : '✗'} ${pad(report.name, nameWidth)}${report.summary}`);
      if (!report.ok && report.hint) lines.push(`  ${report.hint}`);
    }
    p.log.message(lines.join('\n'));
  }
}

export async function runDoctor(args: string[] = []): Promise<void> {
  printBanner();
  const deep = args.includes('--deep');
  p.intro(deep ? '环境体检与自动修复（含采集管线实测）' : '环境体检与自动修复');

  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);

  // Run checks one by one, refreshing the spinner text so the loading animation is visible
  const items: Array<[string, () => CheckReport | Promise<CheckReport>]> = [
    ['Node.js', checkNode],
    ['ffmpeg', checkFfmpeg],
    ['Chromium', checkChromium],
    ['输出目录', checkOutputDir],
    ['MCP 配置', checkMcp],
  ];
  const spinner = p.spinner();
  if (interactive) spinner.start('正在检查运行环境…');
  const reports: CheckReport[] = [];
  for (const [name, check] of items) {
    if (interactive) {
      spinner.message(`正在检查 ${name} …`);
      // The checks themselves are fast (all <100ms); a small pause makes the per-item progress visible
      await new Promise((r) => setTimeout(r, 250));
    }
    reports.push(await check());
  }

  // --deep: real end-to-end capture, verifying the pipeline rather than just the dependencies
  if (deep) {
    const chromiumOk = reports.find((r) => r.name === 'Chromium')?.ok ?? false;
    if (interactive) spinner.message('正在实测采集管线…');
    if (chromiumOk) {
      reports.push(await deepScreenshot());
    } else {
      reports.push({
        group: DEEP_GROUP,
        name: '截图管线',
        ok: false,
        summary: '已跳过 —— Chromium 未安装（先修复上方问题再重试）',
      });
    }
    reports.push(await deepVideo());
  }

  const issues = reports.filter((r) => !r.ok);
  if (interactive) {
    spinner.stop(issues.length === 0 ? '检查完成' : `检查完成，发现 ${issues.length} 个问题`);
  }

  renderReports(reports);

  if (issues.length === 0) {
    p.outro('一切正常');
    return;
  }

  const fixable = issues.filter((i) => i.fix);
  if (fixable.length > 0) {
    if (!interactive) {
      p.log.warn('非交互环境，跳过自动修复；请在终端手动运行 manta-show doctor');
    }
    for (const issue of fixable) {
      const answer = interactive
        ? await p.confirm({
            message: `自动修复「${issue.name}」？（将执行 ${issue.fix!.desc}）`,
          })
        : false;
      if (interactive && p.isCancel(answer)) {
        p.cancel('已取消');
        process.exit(0);
      }
      if (!answer) {
        p.log.step(`已跳过「${issue.name}」`);
        continue;
      }
      const fixSpinner = p.spinner();
      fixSpinner.start(`执行 ${issue.fix!.desc} …`);
      issue.fix!.run();
      fixSpinner.stop('修复动作已执行');
    }
  }

  p.outro('如仍有问题，请重新运行 manta-show doctor 复核');
}
