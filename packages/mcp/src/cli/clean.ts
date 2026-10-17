import fs from 'node:fs';
import * as p from '@clack/prompts';
import { formatBytes, outputDir, scanMediaFiles } from '../util/media.js';

interface CleanOptions {
  /** Delete everything */
  all: boolean;
  /** Delete files older than this many ms */
  olderThanMs?: number;
  /** Skip the confirmation prompt */
  yes: boolean;
}

/** Parse a duration string like 30m / 24h / 7d (plain number = days) into ms */
function parseDuration(raw: string): number | null {
  const m = /^(\d+)\s*(m|h|d)?$/i.exec(raw.trim());
  if (!m) return null;
  const value = Number(m[1]);
  const unit = (m[2] ?? 'd').toLowerCase();
  const ms = unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000;
  return value * ms;
}

function parseArgs(args: string[]): CleanOptions {
  const opts: CleanOptions = { all: false, yes: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--all') opts.all = true;
    else if (arg === '--yes' || arg === '-y') opts.yes = true;
    else if (arg === '--older-than') {
      const ms = parseDuration(args[++i] ?? '');
      if (ms === null) {
        p.log.error('--older-than 需要一个时长参数，例如 --older-than 7d / 24h / 30m');
        process.exit(1);
      }
      opts.olderThanMs = ms;
    }
  }
  return opts;
}

export async function runClean(args: string[]): Promise<void> {
  const opts = parseArgs(args);
  const dir = outputDir();
  const files = scanMediaFiles(dir);

  // Without --all/--older-than: summary only, delete nothing
  if (!opts.all && opts.olderThanMs === undefined) {
    if (files.length === 0) {
      p.log.info(`输出目录 ${dir} 中没有媒体产物`);
      return;
    }
    const total = files.reduce((sum, f) => sum + f.size, 0);
    const oldest = files[files.length - 1];
    p.log.message(
      `输出目录 ${dir}：${files.length} 个产物，共 ${formatBytes(total)}（最早 ${new Date(oldest.mtime).toLocaleString()}）` +
        `\n\n删除方式：` +
        `\n  manta-show clean --older-than 7d    删除 7 天前的产物（也支持 24h / 30m）` +
        `\n  manta-show clean --all              清空全部产物` +
        `\n  追加 -y 跳过确认`,
    );
    return;
  }

  const cutoff = opts.all ? Infinity : Date.now() - opts.olderThanMs!;
  const targets = opts.all ? files : files.filter((f) => f.mtime < cutoff);
  if (targets.length === 0) {
    p.log.info('没有符合条件的产物，无需清理');
    return;
  }
  const freed = targets.reduce((sum, f) => sum + f.size, 0);

  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  if (!opts.yes) {
    if (!interactive) {
      p.log.warn(`非交互环境已中止；如确认请加 -y：将删除 ${targets.length} 个产物（${formatBytes(freed)}）`);
      return;
    }
    const answer = await p.confirm({
      message: `删除 ${targets.length} 个产物（${formatBytes(freed)}）？此操作不可恢复`,
    });
    if (p.isCancel(answer) || !answer) {
      p.cancel('已取消');
      return;
    }
  }

  let deleted = 0;
  let errors = 0;
  for (const file of targets) {
    try {
      fs.unlinkSync(file.path);
      deleted++;
    } catch {
      errors++;
    }
  }
  if (errors > 0) {
    p.log.warn(`删除完成：${deleted} 个成功，${errors} 个失败（文件可能正被占用）`);
  } else {
    p.outro(`已删除 ${deleted} 个产物，释放 ${formatBytes(freed)}`);
  }
}
