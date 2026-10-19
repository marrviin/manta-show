import { chromium, type Browser } from 'playwright';
import { t } from '../i18n/index.js';

let browserPromise: Promise<Browser> | null = null;

/** Lazily loaded global headless Chromium, shared by web sessions and the terminal replay page */
export function getBrowser(): Promise<Browser> {
  browserPromise ??= chromium
    // channel: 'chromium' uses the new headless mode of the full Chromium (the default headless
    // shell compositor doesn't produce frames continuously, so CDP screencast only captures the
    // first instant and recordings come out all black)
    .launch({ headless: true, channel: 'chromium' })
    .catch((e) => {
      browserPromise = null;
      throw new Error(t('browser.launchFail', { message: e.message }));
    });
  return browserPromise;
}
