import type { ElectronApplication, Page } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
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
