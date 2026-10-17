import { copyFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { getBrowser } from './browser.js';

export type RecordDecoration =
  | { kind: 'browser' }
  | { kind: 'terminal' }
  | { kind: 'desktop' };

export interface BrowserChromeSpec {
  /** 页面内容帧宽高（设备像素） */
  contentWidth: number;
  contentHeight: number;
}

export interface TerminalChromeSpec {
  contentWidth: number;
  contentHeight: number;
}

export interface ChromeOverlay {
  pngPath: string;
  /** 内容帧在合成画布上的摆放位置 */
  contentX: number;
  contentY: number;
  /** 合成画布总尺寸（偶数，满足 yuv420p） */
  canvasWidth: number;
  canvasHeight: number;
}

const even = (n: number) => (n % 2 === 0 ? n : n + 1);

/**
 * 渲染 macOS 风格浏览器窗框（红绿灯 + 空白地址栏 + 圆角）。
 * 窗口直接撑满整个画布：无外圈留白、无投影（视频没有透明通道，留白会变成实色大白边）。
 */
export async function renderBrowserChrome(
  spec: BrowserChromeSpec,
  destDir: string,
): Promise<ChromeOverlay> {
  const { contentWidth: cw, contentHeight: ch } = spec;

  // 装饰尺寸以 1280 逻辑宽为基准，随内容宽度等比缩放
  const s = Math.min(2.5, Math.max(1, cw / 1280));
  const bezel = Math.max(2, Math.round(2 * s)); // 窗框包边
  const barH = Math.round(52 * s); // 工具栏高度
  const radius = Math.round(10 * s); // 窗口圆角
  const dotR = Math.round(7 * s); // 红绿灯半径
  const dotGap = Math.round(22 * s);

  const windowW = even(cw + 2 * bezel);
  const windowH = even(barH + ch + 2 * bezel);
  const canvasW = windowW;
  const canvasH = windowH;
  const contentX = bezel;
  const contentY = barH + bezel;

  // 地址栏药丸（空白）：红绿灯右侧留出适度间距，右侧留边
  const pillX = Math.round(100 * s);
  const pillW = windowW - pillX - Math.round(20 * s);
  const pillH = Math.round(30 * s);
  const pillY = Math.round((barH - pillH) / 2);

  const svg = `<svg width="${canvasW}" height="${canvasH}" viewBox="0 0 ${canvasW} ${canvasH}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <clipPath id="winclip">
      <rect width="${windowW}" height="${windowH}" rx="${radius}" ry="${radius}"/>
    </clipPath>
    <mask id="hole">
      <rect width="${windowW}" height="${windowH}" fill="white"/>
      <rect x="${contentX}" y="${contentY}" width="${cw}" height="${ch}" fill="black"/>
    </mask>
  </defs>

  <!-- 窗口体；内容区挖洞保持透明，让录制画面透出 -->
  <g clip-path="url(#winclip)">
    <rect width="${windowW}" height="${windowH}" fill="#ffffff" mask="url(#hole)"/>
    <rect width="${windowW}" height="${barH}" fill="#f6f6f7"/>
    <line x1="0" y1="${barH - 1}" x2="${windowW}" y2="${barH - 1}" stroke="#e2e4e9" stroke-width="${Math.max(1, s)}"/>

    <!-- 红绿灯 -->
    <circle cx="${dotR + 18 * s}" cy="${barH / 2}" r="${dotR}" fill="#ff5f57"/>
    <circle cx="${dotR + 18 * s + dotGap}" cy="${barH / 2}" r="${dotR}" fill="#febc2e"/>
    <circle cx="${dotR + 18 * s + 2 * dotGap}" cy="${barH / 2}" r="${dotR}" fill="#28c840"/>

    <!-- 地址栏药丸（空白） -->
    <rect x="${pillX}" y="${pillY}" width="${pillW}" height="${pillH}" rx="${pillH / 2}" ry="${pillH / 2}" fill="#ffffff" stroke="#dcdce0" stroke-width="${Math.max(1, s)}"/>
  </g>

  <!-- 内容区包边：白边盖住内容直角，与窗口圆角衔接 -->
  <rect x="${contentX - bezel}" y="${contentY - bezel}" width="${cw + 2 * bezel}" height="${ch + 2 * bezel}" rx="${radius}" ry="${radius}" fill="none" stroke="#ffffff" stroke-width="${bezel * 2}"/>
</svg>`;

  return renderOverlaySvg(svg, canvasW, canvasH, destDir, contentX, contentY, false);
}

/**
 * 终端在桌面上的装饰：macOS 桌面壁纸 + 终端窗口（红绿灯空白标题栏、深色内容区带边距），
 * 窗口带圆角投影，看起来像在电脑桌面上开着终端执行命令。
 * 壁纸以本地文件引用（不用 base64 内嵌，渲染快一个量级），由本函数复制到 destDir。
 */
export async function renderTerminalChrome(
  spec: TerminalChromeSpec,
  destDir: string,
): Promise<ChromeOverlay> {
  const { contentWidth: cw, contentHeight: ch } = spec;

  const s = Math.min(2.5, Math.max(1, cw / 1280));
  const margin = Math.round(56 * s); // 窗口四周的壁纸边距
  const pad = Math.round(16 * s); // 终端内容四周的深色边距
  const titleBarH = Math.round(44 * s);
  const radius = Math.round(12 * s);
  const blur = Math.round(18 * s);
  const dotR = Math.round(7 * s);
  const dotGap = Math.round(22 * s);

  const windowW = even(cw + 2 * pad);
  const windowH = even(titleBarH + ch + 2 * pad);
  const canvasW = even(windowW + 2 * margin);
  const canvasH = even(windowH + 2 * margin);
  const winX = margin;
  const winY = margin;
  const contentX = winX + pad;
  const contentY = winY + titleBarH + pad;

  const svg = `<svg width="${canvasW}" height="${canvasH}" viewBox="0 0 ${canvasW} ${canvasH}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="soft" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="${blur}"/>
    </filter>
    <!-- 壁纸在终端窗口处开洞 -->
    <mask id="winHole">
      <rect width="${canvasW}" height="${canvasH}" fill="white"/>
      <rect x="${winX}" y="${winY}" width="${windowW}" height="${windowH}" rx="${radius}" ry="${radius}" fill="black"/>
    </mask>
    <!-- 窗口绘制在终端内容处开洞，让录制画面透出 -->
    <mask id="contentHole">
      <rect width="${canvasW}" height="${canvasH}" fill="white"/>
      <rect x="${contentX}" y="${contentY}" width="${cw}" height="${ch}" fill="black"/>
    </mask>
    <clipPath id="winclip">
      <rect x="${winX}" y="${winY}" width="${windowW}" height="${windowH}" rx="${radius}" ry="${radius}"/>
    </clipPath>
    <!-- 投影只保留窗口轮廓以外 -->
    <mask id="outside">
      <rect width="${canvasW}" height="${canvasH}" fill="white"/>
      <rect x="${winX}" y="${winY}" width="${windowW}" height="${windowH}" rx="${radius}" ry="${radius}" fill="black"/>
    </mask>
  </defs>

  <!-- macOS 桌面壁纸（窗口处开洞） -->
  <g mask="url(#winHole)">
    <image href="wallpaper.jpg" x="0" y="0" width="${canvasW}" height="${canvasH}" preserveAspectRatio="xMidYMid slice"/>
  </g>

  <!-- 终端窗口投影 -->
  <g mask="url(#outside)">
    <rect x="${winX}" y="${winY}" width="${windowW}" height="${windowH}" rx="${radius}" ry="${radius}" fill="#0f172a" opacity="0.5" filter="url(#soft)"/>
  </g>

  <!-- 终端窗口体：标题栏 + 深色内容边距（内容处透出录制画面） -->
  <g clip-path="url(#winclip)" mask="url(#contentHole)">
    <rect width="${canvasW}" height="${canvasH}" fill="#18181b"/>
    <rect width="${canvasW}" height="${winY + titleBarH}" fill="#f6f6f7"/>
    <line x1="0" y1="${winY + titleBarH - 1}" x2="${canvasW}" y2="${winY + titleBarH - 1}" stroke="#e2e4e9" stroke-width="${Math.max(1, s)}"/>
    <circle cx="${winX + dotR + 18 * s}" cy="${winY + titleBarH / 2}" r="${dotR}" fill="#ff5f57"/>
    <circle cx="${winX + dotR + 18 * s + dotGap}" cy="${winY + titleBarH / 2}" r="${dotR}" fill="#febc2e"/>
    <circle cx="${winX + dotR + 18 * s + 2 * dotGap}" cy="${winY + titleBarH / 2}" r="${dotR}" fill="#28c840"/>
  </g>
</svg>`;

  return renderOverlaySvg(svg, canvasW, canvasH, destDir, contentX, contentY, true);
}

/**
 * macOS 桌面装饰：应用窗口（录制内容）带圆角和投影，摆放在桌面壁纸上，无标题栏，
 * 看起来像在电脑上使用。窗口四周留出壁纸边距。
 */
export async function renderDesktopChrome(
  spec: BrowserChromeSpec,
  destDir: string,
): Promise<ChromeOverlay> {
  const { contentWidth: cw, contentHeight: ch } = spec;

  const s = Math.min(2.5, Math.max(1, cw / 1280));
  const margin = Math.round(56 * s); // 窗口四周的壁纸边距
  const radius = Math.round(12 * s); // 窗口圆角
  const blur = Math.round(18 * s); // 投影模糊半径

  const windowW = even(cw);
  const windowH = even(ch);
  const canvasW = even(cw + 2 * margin);
  const canvasH = even(ch + 2 * margin);
  const contentX = margin;
  const contentY = margin;

  const svg = `<svg width="${canvasW}" height="${canvasH}" viewBox="0 0 ${canvasW} ${canvasH}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="soft" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="${blur}"/>
    </filter>
    <!-- 壁纸在窗口处开洞，让录制画面透出 -->
    <mask id="hole">
      <rect width="${canvasW}" height="${canvasH}" fill="white"/>
      <rect x="${contentX}" y="${contentY}" width="${windowW}" height="${windowH}" rx="${radius}" ry="${radius}" fill="black"/>
    </mask>
  </defs>

  <!-- macOS 桌面壁纸（窗口处挖洞） -->
  <g mask="url(#hole)">
    <image href="wallpaper.jpg" x="0" y="0" width="${canvasW}" height="${canvasH}" preserveAspectRatio="xMidYMid slice"/>
  </g>

  <!-- 窗口投影（画在壁纸上、内容之下，且只在窗口轮廓以外） -->
  <g mask="url(#hole)">
    <rect x="${contentX}" y="${contentY}" width="${windowW}" height="${windowH}" rx="${radius}" ry="${radius}" fill="none" stroke="#0f172a" stroke-width="${blur * 2}" opacity="0.5" filter="url(#soft)"/>
  </g>
</svg>`;

  return renderOverlaySvg(svg, canvasW, canvasH, destDir, contentX, contentY, true);
}

/** macOS 官方壁纸（Tahoe）资源路径：位于仓库 assets/ 目录（从编译产物 dist/capture 向上两级） */
function wallpaperPath(): string {
  return path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    'assets',
    'macos-wallpaper.jpg',
  );
}

/**
 * SVG → 带透明通道的 PNG（尺寸与合成画布 1:1）。
 * 需要壁纸时把 assets 壁纸复制到同目录，HTML 以 file:// 相对路径引用（同源可加载，解码快）。
 */
async function renderOverlaySvg(
  svg: string,
  canvasW: number,
  canvasH: number,
  destDir: string,
  contentX: number,
  contentY: number,
  withWallpaper: boolean,
): Promise<ChromeOverlay> {
  const pngPath = path.join(destDir, 'chrome.png');
  const htmlPath = path.join(destDir, 'chrome.html');
  try {
    if (withWallpaper) {
      await copyFile(wallpaperPath(), path.join(destDir, 'wallpaper.jpg'));
    }
    await writeFile(
      htmlPath,
      `<!doctype html><html><head><style>html,body{margin:0;padding:0;background:transparent}</style></head><body>${svg}</body></html>`,
    );

    const browser = await getBrowser();
    const context = await browser.newContext({
      viewport: { width: canvasW, height: canvasH },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    await page.goto(`file://${htmlPath}`);
    // 等壁纸图片解码完成再截图
    await page.evaluate(() => Promise.all(Array.from(document.images).map((img) => img.decode().catch(() => {}))));
    await page.screenshot({ path: pngPath, omitBackground: true });
    await context.close();
  } catch (e) {
    throw new Error(`渲染窗框装饰失败：${e instanceof Error ? e.message : String(e)}`);
  } finally {
    await rm(htmlPath, { force: true }).catch(() => {});
    if (withWallpaper) await rm(path.join(destDir, 'wallpaper.jpg'), { force: true }).catch(() => {});
  }
  return { pngPath, contentX, contentY, canvasWidth: canvasW, canvasHeight: canvasH };
}
