import type { ElectronApplication, Page } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { t } from '../i18n/index.js';
import { BaseCaptureSession, type SessionKind } from '../session.js';

/** An Electron session: one launched app + its first (main) window */
export class ElectronSession extends BaseCaptureSession {
  kind = 'electron' as const satisfies SessionKind;
  readonly mediaPrefix = 'electron';

  constructor(
    id: string,
    public app: ElectronApplication,
    /** The app's main window; named `page` so web/electron tooling can treat both as Playwright pages */
    public page: Page,
  ) {
    super(id);
  }

  protected async release(): Promise<void> {
    await this.app.close().catch(() => {});
  }
}

/**
 * An installed macOS .app (packaged bundle) → use its internal Electron executable via
 * executablePath; a source directory / entry js is passed through unchanged to the local electron.
 */
export function resolveInstalledAppBundle(app: string): string | undefined {
  const bundle = app.endsWith('.app') ? app : undefined;
  if (!bundle) return undefined;
  const name = path.basename(bundle, '.app');
  const bin = path.join(bundle, 'Contents', 'MacOS', name);
  if (fs.existsSync(bin)) return bin;
  throw new Error(t('electron.bundleNotFound', { bundle, name }));
}

/** Platform-relative path of the electron binary inside the electron npm package's dist dir */
function electronDistBin(): string | undefined {
  switch (process.platform) {
    case 'darwin':
      return 'Electron.app/Contents/MacOS/Electron';
    case 'win32':
      return 'electron.exe';
    case 'linux':
      return 'electron';
    default:
      return undefined;
  }
}

/** Nearest `node_modules/electron` binary walking up from startDir (the app's own devDependency) */
export function resolveLocalElectron(startDir: string): string | undefined {
  const rel = electronDistBin();
  if (!rel) return undefined;
  let dir = path.resolve(startDir);
  for (;;) {
    const bin = path.join(dir, 'node_modules', 'electron', 'dist', rel);
    if (fs.existsSync(bin)) return bin;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/** Electron resolved from this package's own dependency tree (dev installs only; the electron devDependency is not published) */
export function resolveOwnElectron(): string | undefined {
  try {
    const bin = createRequire(import.meta.url)('electron') as unknown;
    return typeof bin === 'string' && fs.existsSync(bin) ? bin : undefined;
  } catch {
    return undefined;
  }
}

/**
 * A source app (directory or entry js) is run through its own electron: walk up from the app
 * directory to find the nearest node_modules/electron, then fall back to this package's own.
 * Playwright's no-executablePath fallback requires `electron` from its own package context,
 * which isolated installs (pnpm / npm global) never satisfy — hence the explicit resolution.
 */
export function resolveSourceAppElectron(app: string, cwd?: string): string | undefined {
  const absolute = path.resolve(cwd ?? process.cwd(), app);
  let start: string;
  try {
    start = fs.statSync(absolute).isDirectory() ? absolute : path.dirname(absolute);
  } catch {
    return undefined;
  }
  return resolveLocalElectron(start) ?? resolveOwnElectron();
}
