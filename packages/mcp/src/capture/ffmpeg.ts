import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { homedir } from 'node:os';
import { createGunzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';

let cachedPath: string | null | undefined;

function hasOnPath(bin: string): Promise<boolean> {
  const check = process.platform === 'win32' ? spawn('where', [bin]) : spawn('which', [bin]);
  return new Promise<boolean>((resolve) => {
    check.on('close', (code) => resolve(code === 0));
    check.on('error', () => resolve(false));
  });
}

/** Directory where doctor's guided download stores the ffmpeg binary */
export function managedBinDir(): string {
  return path.join(homedir(), '.manta-show', 'bin');
}

function managedFfmpegPath(): string {
  const name = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  return path.join(managedBinDir(), name);
}

/**
 * Locate ffmpeg:
 * 1. MANTA_SHOW_FFMPEG environment variable
 * 2. ffmpeg on PATH
 * 3. The managed copy downloaded by `manta-show doctor` (~/.manta-show/bin)
 * 4. The fully static build bundled with the ffmpeg-static dependency
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

  const managed = managedFfmpegPath();
  if (fs.existsSync(managed)) {
    cachedPath = managed;
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

/**
 * Download the ffmpeg-static binary matching the current platform into
 * ~/.manta-show/bin. Used by doctor when the optional ffmpeg-static install
 * script failed (e.g. GitHub downloads blocked). Tries the npmmirror binary
 * mirror first (reliable in China), then GitHub Releases.
 */
export async function downloadBundledFfmpeg(): Promise<string> {
  const require = createRequire(import.meta.url);
  const tag = readBinaryReleaseTag(require);
  const asset = `ffmpeg-${process.platform}-${process.arch}.gz`;

  const bases = [
    process.env.FFMPEG_BINARIES_URL,
    'https://registry.npmmirror.com/-/binary/ffmpeg-static',
    'https://github.com/eugeneware/ffmpeg-static/releases/download',
  ].filter((b): b is string => Boolean(b));

  const target = managedFfmpegPath();
  fs.mkdirSync(managedBinDir(), { recursive: true });
  const tmp = `${target}.tmp`;

  let lastError: unknown;
  for (const base of bases) {
    try {
      const res = await fetch(`${base}/${tag}/${asset}`);
      if (!res.ok || !res.body) {
        throw new Error(`HTTP ${res.status} from ${base}`);
      }
      await pipeline(res.body, createGunzip(), fs.createWriteStream(tmp, { mode: 0o755 }));
      fs.renameSync(tmp, target);
      cachedPath = undefined; // re-resolve on next locateFfmpeg
      return target;
    } catch (e) {
      lastError = e;
      fs.rmSync(tmp, { force: true });
    }
  }
  throw new Error(
    `ffmpeg 下载失败（已尝试 ${bases.length} 个源）：${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

/** Read ffmpeg-static's pinned release tag (e.g. b6.1.1) without requiring the binary itself */
function readBinaryReleaseTag(require: NodeRequire): string {
  try {
    const pkg = require('ffmpeg-static/package.json') as {
      'ffmpeg-static'?: { 'binary-release-tag'?: string };
    };
    return pkg['ffmpeg-static']?.['binary-release-tag'] ?? 'b6.1.1';
  } catch {
    return 'b6.1.1';
  }
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
