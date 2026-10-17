import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

/** Media output directory: MANTA_SHOW_OUTPUT takes priority, defaults to ./manta-media under cwd */
export function outputDir(): string {
  const dir = process.env.MANTA_SHOW_OUTPUT || path.join(process.cwd(), 'manta-media');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Generate a collision-free output file path, e.g. /abs/manta-media/video-2026-10-16T10-00-00-000Z-a1b2.mp4 */
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
