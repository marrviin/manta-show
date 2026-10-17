import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';

let cachedPath: string | null | undefined;

function hasOnPath(bin: string): Promise<boolean> {
  const check = process.platform === 'win32' ? spawn('where', [bin]) : spawn('which', [bin]);
  return new Promise<boolean>((resolve) => {
    check.on('close', (code) => resolve(code === 0));
    check.on('error', () => resolve(false));
  });
}

/**
 * Locate ffmpeg:
 * 1. MANTA_SHOW_FFMPEG environment variable
 * 2. ffmpeg on PATH
 * 3. The fully static build bundled with the ffmpeg-static dependency
 *
 * Note: do NOT use playwright's bundled ffmpeg — it's a trimmed build (no concat
 * demuxer / libx264) and cannot assemble an mp4.
 * Returns null when not found; the caller surfaces an actionable error message.
 */
export async function locateFfmpeg(): Promise<string | null> {
  if (cachedPath !== undefined) return cachedPath;

  if (process.env.MANTA_SHOW_FFMPEG && fs.existsSync(process.env.MANTA_SHOW_FFMPEG)) {
    cachedPath = process.env.MANTA_SHOW_FFMPEG;
    return cachedPath;
  }

  if (await hasOnPath('ffmpeg')) {
    cachedPath = 'ffmpeg';
    return cachedPath;
  }

  try {
    const require = createRequire(import.meta.url);
    // ffmpeg-static's default export is the absolute path to the binary
    const bin = require('ffmpeg-static') as string;
    if (bin && fs.existsSync(bin)) {
      cachedPath = bin;
      return cachedPath;
    }
  } catch {
    // Ignore when ffmpeg-static isn't installed
  }

  cachedPath = null;
  return null;
}

/** Run ffmpeg once (overwrites existing output), throwing an error with a stderr summary on failure */
export function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const bin = cachedPath;
    if (!bin) {
      reject(new Error('ffmpeg 未定位，请先调用 locateFfmpeg'));
      return;
    }
    // -y: overwrite existing output files without prompting, avoiding an interactive confirmation hang
    const child = spawn(bin, ['-y', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString();
      if (stderr.length > 8000) stderr = stderr.slice(-4000);
    });
    child.on('error', (e) => reject(new Error(`ffmpeg 启动失败（${bin}）：${e.message}`)));
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg 退出码 ${code}：${stderr.trim().split('\n').slice(-5).join('\n')}`));
    });
  });
}
