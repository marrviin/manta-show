import { chromium, type Browser } from 'playwright';

let browserPromise: Promise<Browser> | null = null;

/** 懒加载的全局无头 Chromium，供 web 会话与终端回放页共用 */
export function getBrowser(): Promise<Browser> {
  browserPromise ??= chromium
    // channel: 'chromium' 使用完整 Chromium 的新无头模式（默认的 headless shell 合成器
    // 不持续出帧，CDP screencast 只能拿到启动瞬间的画面，录制会全黑）
    .launch({ headless: true, channel: 'chromium' })
    .catch((e) => {
      browserPromise = null;
      throw new Error(`启动 Chromium 失败：${e.message}。请先运行 npx playwright install chromium`);
    });
  return browserPromise;
}
