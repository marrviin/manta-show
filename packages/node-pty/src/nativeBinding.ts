/**
 * Copyright (c) 2018, Microsoft Corporation (MIT License).
 *
 * Locates the native bindings for this platform.
 *
 * Prebuilt binaries ship in per-platform packages
 * (`@manta-show/node-pty-<platform>-<arch>`, declared as optionalDependencies).
 * When one is installed it is used directly; otherwise the bindings compiled
 * from source in ../build/{Release,Debug} are loaded, preserving the
 * install-from-source fallback for platforms without a prebuilt package.
 */
import * as path from 'path';

export interface NativeBinding {
  /** The loaded native module. */
  module: any;
  /** Directory that holds the loaded .node file (Release layout). */
  dir: string;
}

const PREBUILT_PACKAGE = `@manta-show/node-pty-${process.platform}-${process.arch}`;

function loadPrebuilt(name: string): NativeBinding | undefined {
  let dir: string;
  try {
    const pkgRoot = path.dirname(require.resolve(`${PREBUILT_PACKAGE}/package.json`));
    dir = path.join(pkgRoot, 'build', 'Release');
  } catch (err) {
    return undefined; // platform package not installed — fall back to the source build
  }
  // The package is installed: surface load failures instead of silently
  // falling back (a broken prebuilt should not hide behind a missing source build).
  return { module: require(path.join(dir, name)), dir };
}

function loadLocalBuild(name: string): NativeBinding {
  const releaseDir = path.join(__dirname, '..', 'build', 'Release');
  try {
    return { module: require(path.join(releaseDir, name)), dir: releaseDir };
  } catch (releaseError) {
    const debugDir = path.join(__dirname, '..', 'build', 'Debug');
    try {
      return { module: require(path.join(debugDir, name)), dir: debugDir };
    } catch (debugError) {
      console.error('innerError', debugError);
      // Re-throw the exception from the Release require if the Debug require fails as well
      throw releaseError;
    }
  }
}

export function loadNative(name: string): NativeBinding {
  return loadPrebuilt(name) || loadLocalBuild(name);
}

/** True when prebuilt bindings from the platform package are available. */
export function hasPrebuiltNative(): boolean {
  try {
    require.resolve(`${PREBUILT_PACKAGE}/package.json`);
    return true;
  } catch (err) {
    return false;
  }
}
