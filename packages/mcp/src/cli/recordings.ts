import { spawn } from 'node:child_process';
import * as p from '@clack/prompts';
import { t } from '../i18n/index.js';
import { formatBytes, outputDir, scanMediaFiles } from '../util/media.js';

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

/** Relative mtime label, e.g. just now / 5 min ago / yesterday 14:30 / 10-01 09:00 (localized) */
function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return t('recordings.justNow');
  if (diff < 3_600_000) return t('recordings.minAgo', { n: Math.floor(diff / 60_000) });
  if (diff < 86_400_000) return t('recordings.hoursAgo', { n: Math.floor(diff / 3_600_000) });
  if (diff < 172_800_000) return t('recordings.yesterday', { time: new Date(ms).toTimeString().slice(0, 5) });
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
    p.log.error(t('recordings.openFail', { target, cmd }));
  });
  child.unref();
}

export async function runRecordings(args: string[]): Promise<void> {
  const opts = parseArgs(args);
  const dir = outputDir();
  const files = scanMediaFiles(dir);

  if (files.length === 0) {
    p.log.warn(t('recordings.empty', { dir }));
    return;
  }

  const shown = opts.last ? files.slice(0, 1) : files.slice(0, opts.limit);
  const totalSize = files.reduce((sum, f) => sum + f.size, 0);

  const rows = shown.map((f) => `${relativeTime(f.mtime)}  ${formatBytes(f.size).padStart(8)}  ${f.name}`);
  p.log.message(
    (opts.last
      ? t('recordings.last')
      : t('recordings.list', { count: files.length, size: formatBytes(totalSize) })) +
      `\n\n` +
      rows.join('\n'),
  );
  if (!opts.last && files.length > shown.length) {
    p.log.info(t('recordings.limit', { n: shown.length }));
  }

  if (opts.open) {
    openPath(shown[0]?.path ?? dir);
  }
}
