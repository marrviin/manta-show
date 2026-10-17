import { spawn } from 'node:child_process';
import * as p from '@clack/prompts';
import { formatBytes, outputDir, scanMediaFiles } from '../util/media.js';
import { printBanner } from './banner.js';

interface RecordingsOptions {
  /** Only show the most recent file */
  last: boolean;
  /** Open the most recent file (or the output dir when there is none) */
  open: boolean;
  /** Max rows in list mode */
  limit: number;
}

/** Parse CLI flags: --last, --open, -n/--limit <count> */
function parseArgs(args: string[]): RecordingsOptions {
  const opts: RecordingsOptions = { last: false, open: false, limit: 20 };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--last') opts.last = true;
    else if (arg === '--open') opts.open = true;
    else if (arg === '-n' || arg === '--limit') {
      const n = Number(args[++i]);
      if (Number.isInteger(n) && n > 0) opts.limit = n;
    }
  }
  return opts;
}

/** Relative mtime label, e.g. 刚刚 / 5 分钟前 / 昨天 14:30 / 10-01 09:00 */
function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 172_800_000) return `昨天 ${new Date(ms).toTimeString().slice(0, 5)}`;
  const d = new Date(ms);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Open a path with the platform file manager / default viewer */
function openPath(target: string): void {
  const cmd =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
  const child = spawn(cmd, [target], { stdio: 'ignore', detached: true });
  child.on('error', () => {
    p.log.error(`无法打开 ${target}（未找到 ${cmd} 命令）`);
  });
  child.unref();
}

export async function runRecordings(args: string[]): Promise<void> {
  const opts = parseArgs(args);
  const dir = outputDir();
  const files = scanMediaFiles(dir);

  printBanner();

  if (files.length === 0) {
    p.log.warn(`输出目录 ${dir} 中还没有媒体产物（截图 / 视频会保存在这里）`);
    return;
  }

  const shown = opts.last ? files.slice(0, 1) : files.slice(0, opts.limit);
  const totalSize = files.reduce((sum, f) => sum + f.size, 0);

  const rows = shown.map((f) => `${relativeTime(f.mtime)}  ${formatBytes(f.size).padStart(8)}  ${f.name}`);
  p.log.message(
    (opts.last ? '最近一次产物' : `最近产物（${files.length} 个，共 ${formatBytes(totalSize)}）`) +
      `\n\n` +
      rows.join('\n'),
  );
  if (!opts.last && files.length > shown.length) {
    p.log.info(`仅显示最新 ${shown.length} 个，可用 -n <数量> 调整`);
  }

  if (opts.open) {
    openPath(shown[0]?.path ?? dir);
  }
}
