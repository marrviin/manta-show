import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { homedir } from 'node:os';
import { createGunzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { t } from '../i18n/index.js';

const FFMPEG_BIN_NAME = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';

/**
 * Pinned sha256 of the gunzipped ffmpeg-static binaries (binary-release-tag b6.1.1), keyed by
 * `${platform}-${arch}`. Must stay in sync with scripts/ffmpeg-sha256.json — the canonical
 * copy the release pipeline's pack-ffmpeg.js verifies against. Re-pin both when FFMPEG_TAG
 * changes in the release workflow.
 */
const FFMPEG_SHA256: Record<string, string> = {
  'darwin-arm64': 'a90e3db6a3fd35f6074b013f948b1aa45b31c6375489d39e572bea3f18336584',
  'darwin-x64': 'ebdddc936f61e14049a2d4b549a412b8a40deeff6540e58a9f2a2da9e6b18894',
  'linux-arm64': '6bb182d0d75d23028db82e9e4f723ca69b853d055698486e6984ddb2c06fb8ce',
  'linux-x64': 'e7e7fb30477f717e6f55f9180a70386c62677ef8a4d4d1a5d948f4098aa3eb99',
  'win32-x64': '04e1307997530f9cf2fe35cba2ca7e8875ca91da02f89d6c7243df819c94ad00',
};

/** Shared error copy for a missing ffmpeg (recorder.ts / tools/cli.ts both surface it) */
export const FFMPEG_MISSING_MESSAGE = t('ffmpeg.missing');

/** Where a located ffmpeg binary came from (used by doctor for display, single source of truth) */
export type FfmpegSource = 'env' | 'path' | 'well-known' | 'managed' | 'bundled';

export interface ResolvedFfmpeg {
  /** 'ffmpeg' when found on PATH, absolute path otherwise */
  path: string;
  source: FfmpegSource;
}

let cached: ResolvedFfmpeg | null | undefined;
// undefined = not probed yet; null = probed but not found — negative results are NOT cached,
// otherwise a server starting before ffmpeg is installed (or before PATH catches up) would
// cache "not found" forever and never pick up the install

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
  return path.join(managedBinDir(), FFMPEG_BIN_NAME);
}

/** Well-known absolute install locations checked when ffmpeg isn't on the server's PATH */
function wellKnownFfmpegPaths(): string[] {
  const dirs =
    process.platform === 'darwin'
      ? // Homebrew's default prefixes on Apple Silicon / Intel
        ['/opt/homebrew/bin', '/usr/local/bin']
      : process.platform === 'linux'
        ? ['/usr/local/bin', '/snap/bin']
        : [];
  return dirs.map((d) => path.join(d, FFMPEG_BIN_NAME));
}

/** Probes used to locate ffmpeg; injectable so the resolution order is unit-testable */
export interface FfmpegProbe {
  env: NodeJS.ProcessEnv;
  /** Absolute candidate paths checked in order (Homebrew etc.), each probed with exists() */
  wellKnownDirs: string[];
  /** Directory where doctor's guided download stores the binary (~/.manta-show/bin) */
  managedDir: string;
  onPath(bin: string): Promise<boolean>;
  exists(p: string): boolean;
  /** Resolve a module id to its absolute file path; throws when not installed */
  require(id: string): unknown;
}

/**
 * Resolve ffmpeg through the given probes, in order:
 * MANTA_SHOW_FFMPEG → PATH → well-known dirs → managed dir → bundled platform package
 * (@manta-show/ffmpeg-<platform>-<arch>)。
 * Stateless — caching lives in locateFfmpeg. Returns null when not found.
 */
export async function resolveFfmpeg(p: FfmpegProbe): Promise<ResolvedFfmpeg | null> {
  const envPath = p.env.MANTA_SHOW_FFMPEG;
  if (envPath && p.exists(envPath)) return { path: envPath, source: 'env' };

  if (await p.onPath('ffmpeg')) return { path: 'ffmpeg', source: 'path' };

  for (const known of p.wellKnownDirs) {
    if (p.exists(known)) return { path: known, source: 'well-known' };
  }

  const managed = path.join(p.managedDir, FFMPEG_BIN_NAME);
  if (p.exists(managed)) return { path: managed, source: 'managed' };

  try {
    // Bundled platform package @manta-show/ffmpeg-<platform>-<arch> (optionalDependency, no
    // install scripts — installs fine even under npm 12's default script blocking). Same
    // resolution as node-pty's nativeBinding.js: require the package.json to get its location.
    const pkgPath = p.require(
      `@manta-show/ffmpeg-${process.platform}-${process.arch}/package.json`,
    ) as string;
    const bin = path.join(path.dirname(pkgPath), FFMPEG_BIN_NAME);
    if (bin && p.exists(bin)) return { path: bin, source: 'bundled' };
  } catch {
    // No bundled package for this platform (not covered by optionalDependencies)
  }

  return null;
}

function realProbe(): FfmpegProbe {
  return {
    env: process.env,
    wellKnownDirs: wellKnownFfmpegPaths(),
    managedDir: managedBinDir(),
    onPath: hasOnPath,
    exists: fs.existsSync,
    require: (id) => createRequire(import.meta.url).resolve(id),
  };
}

/**
 * Locate ffmpeg. Full resolution order: MANTA_SHOW_FFMPEG → PATH → well-known
 * dirs (Homebrew etc.) → managed dir → bundled platform package @manta-show/ffmpeg-<platform>-<arch>
 * (no install scripts; the binary ships inside the npm package). Note: playwright's bundled ffmpeg is
 * deliberately NOT used — it's a trimmed build (no concat demuxer / libx264) and cannot
 * assemble an mp4.
 * Positive results are cached; negative results are NOT — a later-installed ffmpeg is
 * picked up on the next call without restarting the server. Pass a probe to override
 * the environment (used by tests).
 */
export async function locateFfmpeg(probe?: FfmpegProbe): Promise<ResolvedFfmpeg | null> {
  if (cached !== undefined) return cached;
  const found = await resolveFfmpeg(probe ?? realProbe());
  // Negative results are not cached: re-probe on the next call so a freshly installed ffmpeg works without restarting the server
  if (found) cached = found;
  return found;
}

/** The ffmpeg binary resolved by the last successful locateFfmpeg; encode.ts reads it before spawning */
export function ffmpegPath(): string | null {
  return cached?.path ?? null;
}

/** @internal test-only: clear the locate cache */
export function resetFfmpegCacheForTest(): void {
  cached = undefined;
}

/**
 * Download the ffmpeg-static binary matching the current platform into
 * ~/.manta-show/bin. Doctor's fallback repair path: the primary path is now the
 * @manta-show/ffmpeg-<platform>-<arch> platform packages shipped with the npm package (no
 * install scripts, so they install fine under npm 12); this function covers platforms the
 * packages don't cover, or historical installs. Tries the npmmirror binary
 * mirror first (reliable in China), then GitHub Releases.
 * The decompressed binary is verified against the pinned FFMPEG_SHA256 table
 * before it lands; platforms without a pinned digest skip verification.
 * `onProgress` reports raw byte counts (received, total — total may be null
 * when the server sends no content-length) for init/doctor progress display.
 */
export async function downloadBundledFfmpeg(
  onProgress?: (receivedBytes: number, totalBytes: number | null) => void,
): Promise<string> {
  const require = createRequire(import.meta.url);
  const tag = readBinaryReleaseTag(require);
  const asset = `ffmpeg-${process.platform}-${process.arch}.gz`;
  const expectedSha256 = FFMPEG_SHA256[`${process.platform}-${process.arch}`];

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
      const total = Number(res.headers.get('content-length')) || null;
      const hash = expectedSha256 ? createHash('sha256') : null;
      await pipeline(
        res.body,
        async function* (source) {
          let received = 0;
          for await (const chunk of source) {
            received += chunk.length;
            onProgress?.(received, total);
            yield chunk;
          }
        },
        createGunzip(),
        // Hash the decompressed bytes on the way into the file, so the digest
        // matches the pinned table (and the binary the platforms ship)
        async function* (source) {
          for await (const chunk of source) {
            hash?.update(chunk);
            yield chunk;
          }
        },
        fs.createWriteStream(tmp, { mode: 0o755 }),
      );
      if (hash) {
        const digest = hash.digest('hex');
        if (digest !== expectedSha256) {
          throw new Error(
            t('ffmpeg.shaMismatch', {
              expected: expectedSha256!.slice(0, 12),
              actual: digest.slice(0, 12),
            }),
          );
        }
      }
      fs.renameSync(tmp, target);
      cached = undefined; // re-resolve on next locateFfmpeg
      return target;
    } catch (e) {
      lastError = e;
      fs.rmSync(tmp, { force: true });
    }
  }
  throw new Error(
    t('ffmpeg.downloadFail', {
      count: bases.length,
      message: lastError instanceof Error ? lastError.message : String(lastError),
    }),
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
