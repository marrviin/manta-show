import type { BrowserContext, Page } from 'playwright';
import { BaseCaptureSession, type SessionKind } from '../session.js';

/** A web session: one isolated browser context + page in the shared headless Chromium */
export class WebSession extends BaseCaptureSession {
  kind = 'web' as const satisfies SessionKind;
  readonly mediaPrefix = 'web';

  constructor(
    id: string,
    public context: BrowserContext,
    public page: Page,
  ) {
    super(id);
  }

  protected async release(): Promise<void> {
    await this.context.close().catch(() => {});
  }
}
