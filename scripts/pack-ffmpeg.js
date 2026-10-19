//@ts-check

/**
 * Assembles a prebuilt ffmpeg platform package from a downloaded binary.
 *
 * Usage: node scripts/pack-ffmpeg.js [--out <dir>] [--bin <path>]
 *                                     [--platform <p>] [--arch <a>] [--tag <t>]
 * Emits <out-dir>/@manta-show/ffmpeg-<platform>-<arch>/ plus a packed .tgz
 * ready for `npm publish`. The binary comes from ffmpeg-static's release
 * assets (static builds, GPL): CI downloads and gunzips it right before:
 *
 *   curl -fsSL "https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-darwin-arm64.gz" > ffmpeg
 *
 * The packages deliberately carry NO lifecycle scripts: npm 12 blocks
 * dependency install scripts by default, so the binary must ship in-tarball
 * and be resolved at require time (see packages/mcp/src/capture/ffmpeg.ts).
 */
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const outDir = path.resolve(flag('--out') || 'ffmpeg-out');
const binPath = path.resolve(flag('--bin') || (process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'));
const platform = flag('--platform') || process.platform;
const arch = flag('--arch') || process.arch;
const tag = flag('--tag') || 'b6.1.1';
const version = tag.replace(/^b/, '');
const name = `@manta-show/ffmpeg-${platform}-${arch}`;

if (!fs.existsSync(binPath)) {
  console.error(`No ffmpeg binary found at ${binPath}. Download it first (see file header).`);
  process.exit(1);
}

// Guard against packing a mismatched binary: verify the binary's reported
// architecture matches what we are about to publish, and that it is actually
// an executable image (not a still-gzipped download — the gzip header embeds
// the original filename, which would otherwise satisfy the arch token check).
// `file` spells archs differently per platform (x86_64 vs x86-64, arm64 vs
// aarch64), so allow all spellings.
const expectedArchs = { arm64: ['arm64', 'aarch64'], x64: ['x86_64', 'x86-64', 'amd64'] }[arch];
const imageFormats = { darwin: ['Mach-O'], linux: ['ELF'], win32: ['PE32'] };
if (expectedArchs && platform !== 'win32') {
  const { execSync } = require('child_process');
  const info = execSync(`file "${binPath}"`, { encoding: 'utf8' });
  const formats = imageFormats[platform] ?? [];
  if (!formats.some((f) => info.includes(f)) || !expectedArchs.some((a) => info.includes(a))) {
    console.error(
      `Refusing to pack: binary is not a ${formats.join('/')} ${expectedArchs.join('/')} image.\n  ${info.trim()}`,
    );
    process.exit(1);
  }
}

// Verify the binary against the pinned sha256 table (scripts/ffmpeg-sha256.json) before
// publishing: guards the release pipeline against a tampered/changed upstream asset and
// keeps the digests used by the runtime's download verification (deps/ffmpeg.ts) honest.
// Re-pin both when FFMPEG_TAG changes in the release workflow.
const { createHash } = require('crypto');
const shaTable = require('./ffmpeg-sha256.json');
const wantSha = shaTable[`${platform}-${arch}`];
if (!wantSha) {
  console.error(`No pinned sha256 for ${platform}-${arch} in scripts/ffmpeg-sha256.json — add it before packing.`);
  process.exit(1);
}
const gotSha = createHash('sha256').update(fs.readFileSync(binPath)).digest('hex');
if (gotSha !== wantSha) {
  console.error(
    `Refusing to pack: sha256 mismatch for ${binPath}\n  expected ${wantSha}\n  actual   ${gotSha}\n` +
      'If ffmpeg-static released a new build for the same tag, re-pin scripts/ffmpeg-sha256.json and deps/ffmpeg.ts.',
  );
  process.exit(1);
}

const target = path.join(outDir, name);
fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(target, { recursive: true });

const binName = platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
fs.copyFileSync(binPath, path.join(target, binName));
if (platform !== 'win32') fs.chmodSync(path.join(target, binName), 0o755);

// The redistributed binary is a GPL build of FFmpeg (libx264); ship a license
// note pointing at the upstream sources for GPL compliance.
fs.writeFileSync(
  path.join(target, 'LICENSE'),
  [
    `@manta-show/ffmpeg-${platform}-${arch} ${version}`,
    '',
    'This package redistributes a prebuilt static FFmpeg binary obtained from',
    `eugeneware/ffmpeg-static release ${tag} (https://github.com/eugeneware/ffmpeg-static).`,
    'The binary is built with libx264 and is licensed under the GNU General Public',
    'License. FFmpeg source code: https://ffmpeg.org/download.html',
    '',
    'ffmpeg-static itself is MIT licensed (https://github.com/eugeneware/ffmpeg-static/blob/master/LICENSE).',
    '',
  ].join('\n'),
);

const packageJson = {
  name,
  version,
  description: `Prebuilt static FFmpeg binary for @manta-show/mcp (${platform}-${arch}, ffmpeg-static ${tag}).`,
  license: 'GPL-3.0',
  repository: {
    type: 'git',
    url: 'git+https://github.com/marrviin/manta-show.git',
    directory: 'scripts',
  },
  os: [platform],
  cpu: [arch],
  files: [binName, 'LICENSE'],
  publishConfig: {
    registry: 'https://registry.npmjs.org/',
    access: 'public',
  },
};
fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify(packageJson, null, 2) + '\n');

const { execSync } = require('child_process');
execSync('npm pack --silent', { cwd: target, stdio: 'inherit' });
console.log(`Assembled ${target}`);
