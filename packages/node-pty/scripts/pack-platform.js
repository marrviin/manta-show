//@ts-check

/**
 * Assembles a prebuilt platform package from a compiled build/Release.
 *
 * Usage: node scripts/pack-platform.js [--out <dir>] [--platform <p>] [--arch <a>]
 * Emits <out-dir>/@manta-show/node-pty-<platform>-<arch>/ ready for
 * `npm publish`. Platform/arch come from the machine this runs on — build
 * (cross-)compile first, e.g. `node-gyp rebuild --arch=x64` on macOS.
 */
const fs = require('fs');
const path = require('path');

const pkgRoot = path.join(__dirname, '..');
const pkg = require(path.join(pkgRoot, 'package.json'));

// Defaults to the host; override when packing a cross-compiled build,
// e.g. `node scripts/pack-platform.js --out out --arch=x64` on macOS.
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const outDir = path.resolve(flag('--out') || path.join(pkgRoot, 'platform-out'));
const platform = flag('--platform') || process.platform;
const arch = flag('--arch') || process.arch;
const name = `@manta-show/node-pty-${platform}-${arch}`;

const releaseDir = path.join(pkgRoot, 'build', 'Release');
const entry = platform === 'win32' ? 'conpty.node' : 'pty.node';
if (!fs.existsSync(path.join(releaseDir, entry))) {
  console.error(`No native build found at ${releaseDir} (missing ${entry}). Run \`node-gyp rebuild\` first.`);
  process.exit(1);
}

// Guard against packing a stale or wrong-arch build (e.g. after cross-compiling
// the other arch in the same build/Release dir): verify the binary's reported
// architecture matches what we are about to publish.
const expectedArch = { arm64: 'arm64', x64: 'x86_64' }[arch];
if (expectedArch && platform !== 'win32') {
  const { execSync } = require('child_process');
  const info = execSync(`file "${path.join(releaseDir, entry)}"`, { encoding: 'utf8' });
  if (!info.includes(expectedArch)) {
    console.error(`Refusing to pack: ${entry} is not ${expectedArch}.\n  ${info.trim()}\nRe-run \`node-gyp rebuild --arch=${arch}\` immediately before packing.`);
    process.exit(1);
  }
}

const target = path.join(outDir, name);
fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(path.join(target, 'build'), { recursive: true });
fs.cpSync(releaseDir, path.join(target, 'build', 'Release'), { recursive: true });
fs.copyFileSync(path.join(pkgRoot, 'LICENSE'), path.join(target, 'LICENSE'));

// Strip build-internal artifacts: symbols and IDE tooling are not needed at runtime.
const strip = ['compile_commands.json'];
function stripJunk(dir) {
  for (const file of fs.readdirSync(dir)) {
    const full = path.join(dir, file);
    if (fs.statSync(full).isDirectory()) {
      stripJunk(full);
    } else if (strip.includes(file) || file.endsWith('.pdb')) {
      fs.unlinkSync(full);
    }
  }
}
stripJunk(path.join(target, 'build', 'Release'));

const packageJson = {
  name,
  version: pkg.version,
  description: `Prebuilt native bindings for @manta-show/node-pty (${platform}-${arch}).`,
  license: 'MIT',
  repository: {
    type: 'git',
    url: pkg.repository.url,
    directory: 'packages/node-pty'
  },
  os: [platform],
  cpu: [arch],
  files: ['build/', 'LICENSE'],
  publishConfig: {
    registry: 'https://registry.npmjs.org/',
    access: 'public'
  }
};
fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify(packageJson, null, 2) + '\n');

const { execSync } = require('child_process');
execSync('npm pack --silent', { cwd: target, stdio: 'inherit' });
console.log(`Assembled ${target}`);
