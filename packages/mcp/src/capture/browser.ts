import { chromium, type Browser } from 'playwright';

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
      throw new Error(`启动 Chromium 失败：${e.message}。请先运行 npx playwright install chromium`);
    });
  return browserPromise;
}
