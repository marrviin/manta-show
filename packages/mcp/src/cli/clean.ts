import fs from 'node:fs';
import * as p from '@clack/prompts';
import { t } from '../i18n/index.js';
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
        p.log.error(t('clean.needDuration'));
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
      p.log.info(t('clean.empty', { dir }));
      return;
    }
    const total = files.reduce((sum, f) => sum + f.size, 0);
    const oldest = files[files.length - 1];
    p.log.message(
      t('clean.summary', {
        dir,
        count: files.length,
        size: formatBytes(total),
        date: new Date(oldest.mtime).toLocaleString(),
      }),
    );
    return;
  }

  const cutoff = opts.all ? Infinity : Date.now() - opts.olderThanMs!;
  const targets = opts.all ? files : files.filter((f) => f.mtime < cutoff);
  if (targets.length === 0) {
    p.log.info(t('clean.nothing'));
    return;
  }
  const freed = targets.reduce((sum, f) => sum + f.size, 0);

  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  if (!opts.yes) {
    if (!interactive) {
      p.log.warn(t('clean.aborted', { count: targets.length, size: formatBytes(freed) }));
      return;
    }
    const answer = await p.confirm({
      message: t('clean.confirm', { count: targets.length, size: formatBytes(freed) }),
    });
    if (p.isCancel(answer) || !answer) {
      p.cancel(t('clean.cancelled'));
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
    p.log.warn(t('clean.deletedWithErrors', { deleted, failed: errors }));
  } else {
    p.outro(t('clean.deleted', { count: deleted, size: formatBytes(freed) }));
  }
}
