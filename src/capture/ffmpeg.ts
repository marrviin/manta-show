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
 * 定位 ffmpeg：
 * 1. MANTA_SHOW_FFMPEG 环境变量
 * 2. PATH 上的 ffmpeg
 * 3. ffmpeg-static 依赖自带的全静态构建
 *
 * 注意不用 playwright 自带的 ffmpeg：它是裁剪版（无 concat demuxer / libx264），合成不了 mp4。
 * 找不到返回 null，由调用方给出可操作的错误提示。
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
    // ffmpeg-static 的默认导出就是二进制文件的绝对路径
    const bin = require('ffmpeg-static') as string;
    if (bin && fs.existsSync(bin)) {
      cachedPath = bin;
      return cachedPath;
    }
  } catch {
    // ffmpeg-static 未安装时忽略
  }

  cachedPath = null;
  return null;
}

/** 运行一次 ffmpeg，失败时抛出带 stderr 摘要的错误 */
export function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const bin = cachedPath;
    if (!bin) {
      reject(new Error('ffmpeg 未定位，请先调用 locateFfmpeg'));
      return;
    }
    const child = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
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
