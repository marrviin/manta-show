import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

/** 媒体输出目录：MANTA_SHOW_OUTPUT 优先，默认 cwd 下 ./manta-media */
export function outputDir(): string {
  const dir = process.env.MANTA_SHOW_OUTPUT || path.join(process.cwd(), 'manta-media');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** 生成一个不冲突的输出文件路径，如 /abs/manta-media/video-2026-10-16T10-00-00-000Z-a1b2.mp4 */
export function mediaPath(kind: string, ext: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const name = `${kind}-${stamp}-${randomBytes(3).toString('hex')}.${ext}`;
  return path.join(outputDir(), name);
}

/** 相对 cwd 的路径，用于 markdown 引用片段 */
export function relativeRef(file: string): string {
  const rel = path.relative(process.cwd(), file);
  return rel.startsWith('..') ? file : rel;
}
