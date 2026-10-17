//@ts-check

const { execSync } = require('child_process');

// Declaring an explicit `install` script replaces npm's implicit
// `node-gyp rebuild` default (triggered by the presence of binding.gyp), so a
// global install with prebuilt bindings no longer needs a local toolchain.
const PREBUILT_PACKAGE = `@manta-show/node-pty-${process.platform}-${process.arch}`;
try {
  require.resolve(`${PREBUILT_PACKAGE}/package.json`);
  console.log(`\x1b[32m> Using prebuilt native bindings from ${PREBUILT_PACKAGE}\x1b[0m`);
  process.exit(0);
} catch (e) {
  // No prebuilt package for this platform — build from source.
}

execSync('node-gyp rebuild', { stdio: 'inherit' });
