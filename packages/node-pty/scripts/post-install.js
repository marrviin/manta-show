//@ts-check

const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const RELEASE_DIR = path.join(__dirname, '../build/Release');
const BUILD_FILES = [
  path.join(RELEASE_DIR, 'conpty.node'),
  path.join(RELEASE_DIR, 'conpty.pdb'),
  path.join(RELEASE_DIR, 'conpty_console_list.node'),
  path.join(RELEASE_DIR, 'conpty_console_list.pdb'),
  path.join(RELEASE_DIR, 'pty.node'),
  path.join(RELEASE_DIR, 'pty.pdb'),
  path.join(RELEASE_DIR, 'spawn-helper'),
  path.join(RELEASE_DIR, 'winpty-agent.exe'),
  path.join(RELEASE_DIR, 'winpty-agent.pdb'),
  path.join(RELEASE_DIR, 'winpty.dll'),
  path.join(RELEASE_DIR, 'winpty.pdb')
];
const CONPTY_DIR = path.join(__dirname, '../third_party/conpty');
const CONPTY_SUPPORTED_ARCH = ['x64', 'arm64'];

// When the prebuilt platform package is in use, build/Release is not ours to
// maintain and the conpty copy below is already part of that package.
const PREBUILT_PACKAGE = `@manta-show/node-pty-${process.platform}-${process.arch}`;
try {
  require.resolve(`${PREBUILT_PACKAGE}/package.json`);
  console.log(`\x1b[32m> Prebuilt bindings in use (${PREBUILT_PACKAGE}) — skipping build-folder maintenance\x1b[0m`);
  process.exit(0);
} catch (e) {
  // fall through: source build
}

console.log('\x1b[32m> Cleaning release folder...\x1b[0m');

function cleanFolderRecursive(folder) {
  var files = [];
  if (fs.existsSync(folder)) {
    files = fs.readdirSync(folder);
    files.forEach(function(file,index) {
      var curPath = path.join(folder, file);
      if (fs.lstatSync(curPath).isDirectory()) { // recurse
        cleanFolderRecursive(curPath);
        fs.rmdirSync(curPath);
      } else if (BUILD_FILES.indexOf(curPath) < 0){ // delete file
        fs.unlinkSync(curPath);
      }
    });
  }
};

try {
  cleanFolderRecursive(RELEASE_DIR);
} catch(e) {
  console.log(e);
  process.exit(1);
}

console.log(`\x1b[32m> Moving conpty.dll...\x1b[0m`);
if (os.platform() !== 'win32') {
  console.log('  SKIPPED (not Windows)');
} else {
  let windowsArch;
  if (process.env.npm_config_arch) {
    windowsArch = process.env.npm_config_arch;
    console.log(`  Using $npm_config_arch: ${windowsArch}`);
  } else {
    windowsArch = os.arch();
    console.log(`  Using os.arch(): ${windowsArch}`);
  }

  if (!CONPTY_SUPPORTED_ARCH.includes(windowsArch)) {
    console.log(`  SKIPPED (unsupported architecture ${windowsArch})`);
  } else {
    const versionFolder = fs.readdirSync(CONPTY_DIR)[0];
    console.log(`  Found version ${versionFolder}`);
    const sourceFolder = path.join(CONPTY_DIR, versionFolder, `win10-${windowsArch}`);
    const destFolder = path.join(RELEASE_DIR, 'conpty');
    fs.mkdirSync(destFolder, { recursive: true });
    for (const file of ['conpty.dll', 'OpenConsole.exe']) {
      const sourceFile = path.join(sourceFolder, file);
      const destFile = path.join(destFolder, file);
      console.log(`  Copying ${sourceFile} -> ${destFile}`);
      fs.copyFileSync(sourceFile, destFile);
    }
  }
}

console.log(`\x1b[32m> Generating compile_commands.json...\x1b[0m`);
// Best-effort only: this file is IDE/clangd tooling input, nothing at runtime
// depends on it. `npx node-gyp` cannot resolve local bins under
// npm_config_global=true (i.e. every `npm install -g` lifecycle), so a failure
// here must not fail the whole install.
try {
  execSync('npx node-gyp configure -- -f compile_commands_json', { stdio: 'ignore' });
} catch (e) {
  console.log('  SKIPPED (npx node-gyp unavailable — compile_commands.json is dev tooling only)');
}

process.exit(0);
