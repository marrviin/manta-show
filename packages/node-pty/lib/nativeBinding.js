"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hasPrebuiltNative = exports.loadNative = void 0;
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
var path = require("path");
var PREBUILT_PACKAGE = "@manta-show/node-pty-" + process.platform + "-" + process.arch;
function loadPrebuilt(name) {
    var dir;
    try {
        var pkgRoot = path.dirname(require.resolve(PREBUILT_PACKAGE + "/package.json"));
        dir = path.join(pkgRoot, 'build', 'Release');
    }
    catch (err) {
        return undefined; // platform package not installed — fall back to the source build
    }
    // The package is installed: surface load failures instead of silently
    // falling back (a broken prebuilt should not hide behind a missing source build).
    return { module: require(path.join(dir, name)), dir: dir };
}
function loadLocalBuild(name) {
    var releaseDir = path.join(__dirname, '..', 'build', 'Release');
    try {
        return { module: require(path.join(releaseDir, name)), dir: releaseDir };
    }
    catch (releaseError) {
        var debugDir = path.join(__dirname, '..', 'build', 'Debug');
        try {
            return { module: require(path.join(debugDir, name)), dir: debugDir };
        }
        catch (debugError) {
            console.error('innerError', debugError);
            // Re-throw the exception from the Release require if the Debug require fails as well
            throw releaseError;
        }
    }
}
function loadNative(name) {
    return loadPrebuilt(name) || loadLocalBuild(name);
}
exports.loadNative = loadNative;
/** True when prebuilt bindings from the platform package are available. */
function hasPrebuiltNative() {
    try {
        require.resolve(PREBUILT_PACKAGE + "/package.json");
        return true;
    }
    catch (err) {
        return false;
    }
}
exports.hasPrebuiltNative = hasPrebuiltNative;
//# sourceMappingURL=nativeBinding.js.map