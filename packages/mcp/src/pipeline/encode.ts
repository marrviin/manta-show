import { spawn } from 'node:child_process';
import { t } from '../i18n/index.js';
import { ffmpegPath } from '../deps/ffmpeg.js';

/** Run ffmpeg once (overwrites existing output), throwing an error with a stderr summary on failure */
export function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const bin = ffmpegPath();
    if (!bin) {
      reject(new Error(t('encode.notLocated')));
      return;
    }
    // -y: overwrite existing output files without prompting, avoiding an interactive confirmation hang
    const child = spawn(bin, ['-y', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString();
      if (stderr.length > 8000) stderr = stderr.slice(-4000);
    });
    child.on('error', (e) => reject(new Error(t('encode.spawnFail', { bin, message: e.message }))));
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(t('encode.exitCode', { code: code ?? -1, tail: stderr.trim().split('\n').slice(-5).join('\n') })));
    });
  });
}
