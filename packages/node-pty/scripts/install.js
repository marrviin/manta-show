//@ts-check

const { execSync } = require('child_process');

// Declaring an explicit `install` script replaces npm's implicit
// `node-gyp rebuild` default (triggered by the presence of binding.gyp), so a
// global install with prebuilt bindings no longer needs a local toolchain.
// Linux ships two libc families — glibc and musl (Alpine) — with mutually
// incompatible binaries, so the prebuilt package name carries the libc: musl
// builds resolve @manta-show/node-pty-linux-<arch>-musl. Detected via
// process.report (musl builds report no glibcVersionRuntime); without the
// report API (rare) the glibc name is kept.
function prebuiltPackageName() {
  if (process.platform === 'linux') {
    try {
      const report = process.report && process.report.getReport();
      if (report && !report.header.glibcVersionRuntime) {
        return `@manta-show/node-pty-linux-${process.arch}-musl`;
      }
    } catch (e) {
      // fall through to the glibc name
    }
  }
  return `@manta-show/node-pty-${process.platform}-${process.arch}`;
}

const PREBUILT_PACKAGE = prebuiltPackageName();
try {
  require.resolve(`${PREBUILT_PACKAGE}/package.json`);
  console.log(`\x1b[32m> Using prebuilt native bindings from ${PREBUILT_PACKAGE}\x1b[0m`);
  process.exit(0);
} catch (e) {
  // No prebuilt package for this platform — build from source.
}

execSync('node-gyp rebuild', { stdio: 'inherit' });
