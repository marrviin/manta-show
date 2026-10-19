import fs from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

/**
 * Media output directory: fixed at ~/.manta-show/media (next to the managed bin/ dir) so all
 * artifacts land in one predictable place for `manta-show recordings` / `clean` to manage.
 */
export function outputDir(): string {
  const dir = path.join(homedir(), '.manta-show', 'media');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Generate a collision-free output file path, e.g. /abs/.manta-show/media/web-video-...-a1b2.mp4 */
export function mediaPath(kind: string, ext: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const name = `${kind}-${stamp}-${randomBytes(3).toString('hex')}.${ext}`;
  return path.join(outputDir(), name);
}

/** Path relative to cwd, used for markdown reference snippets */
export function relativeRef(file: string): string {
  const rel = path.relative(process.cwd(), file);
  return rel.startsWith('..') ? file : rel;
}

/** Media file extensions produced by the capture pipeline (screenshots, videos) */
const MEDIA_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.mp4', '.webm']);

export interface MediaFile {
  path: string;
  name: string;
  size: number;
  /** mtime in ms since epoch */
  mtime: number;
}

/** List media files in the output directory, newest first; missing dir yields [] */
export function scanMediaFiles(dir: string = outputDir()): MediaFile[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: MediaFile[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !MEDIA_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
    const full = path.join(dir, entry.name);
    try {
      const stat = fs.statSync(full);
      files.push({ path: full, name: entry.name, size: stat.size, mtime: stat.mtimeMs });
    } catch {
      // File removed between readdir and stat; skip it
    }
  }
  return files.sort((a, b) => b.mtime - a.mtime);
}

/** Human-readable byte size, e.g. 1.2 MB / 834 KB */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}
