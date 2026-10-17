import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import * as p from '@clack/prompts';
import { chromium } from 'playwright';
import { locateFfmpeg } from '../capture/ffmpeg.js';
import { outputDir } from '../util/media.js';
import { listAgentStatuses, runInit } from './init.js';
import { printBanner } from './banner.js';

interface Fix {
  desc: string;
  run: () => void;
}

interface CheckReport {
  /** 分组标题：环境依赖 / 输出与接入 */
  group: string;
  name: string;
  ok: boolean;
  /** 对齐展示用的一行摘要（不放长路径） */
  summary: string;
  /** 失败时的手动建议，挂在对应条目下方 */
  hint?: string;
  /** 用户确认后可执行的自动修复 */
  fix?: Fix;
}

function whichSync(bin: string): boolean {
  return (process.env.PATH ?? '')
    .split(path.delimiter)
    .some((dir) => dir && fs.existsSync(path.join(dir, bin)));
}

/** 中文等全角字符按 2 列计，用于结果表对齐 */
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
    // registry 异常时按未安装处理
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
  const dir = process.env.MANTA_SHOW_OUTPUT ?? './manta-media';
  try {
    fs.accessSync(outputDir(), fs.constants.W_OK); // outputDir 会顺带自动创建目录
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

/** 按分组渲染结果表：组头 + 名称对齐 + ✓/✗，失败条目下挂手动建议 */
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

export async function runDoctor(): Promise<void> {
  printBanner();
  p.intro('环境体检与自动修复');

  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);

  // 逐项检查并同步刷新 spinner 文案，让 loading 动画可见
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
      // 检查本身极快（全部 <100ms），加个小停顿让逐项进度能被看见
      await new Promise((r) => setTimeout(r, 250));
    }
    reports.push(await check());
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
