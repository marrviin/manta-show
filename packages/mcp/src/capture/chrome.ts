import { copyFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { getBrowser } from './browser.js';

export type RecordDecoration =
  | { kind: 'browser' }
  | { kind: 'terminal' }
  | { kind: 'desktop' };

export interface BrowserChromeSpec {
  /** Content frame dimensions (device pixels) */
  contentWidth: number;
  contentHeight: number;
}

export interface TerminalChromeSpec {
  contentWidth: number;
  contentHeight: number;
}

export interface ChromeOverlay {
  pngPath: string;
  /** Placement of the content frame on the composite canvas */
  contentX: number;
  contentY: number;
  /** Total composite canvas size (even, to satisfy yuv420p) */
  canvasWidth: number;
  canvasHeight: number;
}

const even = (n: number) => (n % 2 === 0 ? n : n + 1);

/**
 * Render a macOS-style browser window chrome (traffic lights + blank address bar + rounded corners).
 * The window fills the entire canvas: no outer padding, no shadow (video has no alpha channel;
 * padding would render as a solid white border).
 */
export async function renderBrowserChrome(
  spec: BrowserChromeSpec,
  destDir: string,
): Promise<ChromeOverlay> {
  const { contentWidth: cw, contentHeight: ch } = spec;

  // Decoration sizes are based on a 1280 logical width, scaled proportionally with the content width
  const s = Math.min(2.5, Math.max(1, cw / 1280));
  const bezel = Math.max(2, Math.round(2 * s)); // window frame bezel
  const barH = Math.round(52 * s); // toolbar height
  const radius = Math.round(10 * s); // window corner radius
  const dotR = Math.round(7 * s); // traffic light radius
  const dotGap = Math.round(22 * s);

  const windowW = even(cw + 2 * bezel);
  const windowH = even(barH + ch + 2 * bezel);
  const canvasW = windowW;
  const canvasH = windowH;
  const contentX = bezel;
  const contentY = barH + bezel;

  // Address bar pill (blank): moderate spacing right of the traffic lights, margin on the right
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

  <!-- Window body; the content area is punched out to stay transparent so the recording shows through -->
  <g clip-path="url(#winclip)">
    <rect width="${windowW}" height="${windowH}" fill="#ffffff" mask="url(#hole)"/>
    <rect width="${windowW}" height="${barH}" fill="#f6f6f7"/>
    <line x1="0" y1="${barH - 1}" x2="${windowW}" y2="${barH - 1}" stroke="#e2e4e9" stroke-width="${Math.max(1, s)}"/>

    <!-- Traffic lights -->
    <circle cx="${dotR + 18 * s}" cy="${barH / 2}" r="${dotR}" fill="#ff5f57"/>
    <circle cx="${dotR + 18 * s + dotGap}" cy="${barH / 2}" r="${dotR}" fill="#febc2e"/>
    <circle cx="${dotR + 18 * s + 2 * dotGap}" cy="${barH / 2}" r="${dotR}" fill="#28c840"/>

    <!-- Address bar pill (blank) -->
    <rect x="${pillX}" y="${pillY}" width="${pillW}" height="${pillH}" rx="${pillH / 2}" ry="${pillH / 2}" fill="#ffffff" stroke="#dcdce0" stroke-width="${Math.max(1, s)}"/>
  </g>

  <!-- Content bezel: white border covers the content's square corners and joins the window's rounded ones -->
  <rect x="${contentX - bezel}" y="${contentY - bezel}" width="${cw + 2 * bezel}" height="${ch + 2 * bezel}" rx="${radius}" ry="${radius}" fill="none" stroke="#ffffff" stroke-width="${bezel * 2}"/>
</svg>`;

  return renderOverlaySvg(svg, canvasW, canvasH, destDir, contentX, contentY, false);
}

/**
 * Desktop decoration for the terminal: macOS wallpaper + terminal window (blank traffic-light title
 * bar, dark content area with padding), window has rounded corners and a shadow, looking like a
 * terminal running commands on a computer desktop.
 * The wallpaper is referenced as a local file (no base64 embedding, an order of magnitude faster to
 * render); this function copies it into destDir.
 */
export async function renderTerminalChrome(
  spec: TerminalChromeSpec,
  destDir: string,
): Promise<ChromeOverlay> {
  const { contentWidth: cw, contentHeight: ch } = spec;

  const s = Math.min(2.5, Math.max(1, cw / 1280));
  const margin = Math.round(56 * s); // wallpaper margin around the window
  const pad = Math.round(16 * s); // dark padding around the terminal content
  const titleBarH = Math.round(44 * s);
  const radius = Math.round(12 * s);
  const blur = Math.round(18 * s);
  const dotR = Math.round(7 * s);
  const dotGap = Math.round(22 * s);

  const windowW = even(cw + 2 * pad);
  const windowH = even(titleBarH + ch + 2 * pad);
  // Canvas is 16:9 (same ratio as the unified output canvas, so the final scale crops/letterboxes nothing); window centered on the wallpaper
  const minW = windowW + 2 * margin;
  const minH = windowH + 2 * margin;
  const canvasW = even(Math.max(minW, Math.round((minH * 16) / 9)));
  const canvasH = even(Math.max(minH, Math.round((canvasW * 9) / 16)));
  const winX = Math.round((canvasW - windowW) / 2);
  const winY = Math.round((canvasH - windowH) / 2);
  const contentX = winX + pad;
  const contentY = winY + titleBarH + pad;

  const svg = `<svg width="${canvasW}" height="${canvasH}" viewBox="0 0 ${canvasW} ${canvasH}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="soft" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="${blur}"/>
    </filter>
    <!-- Wallpaper with a hole punched at the terminal window -->
    <mask id="winHole">
      <rect width="${canvasW}" height="${canvasH}" fill="white"/>
      <rect x="${winX}" y="${winY}" width="${windowW}" height="${windowH}" rx="${radius}" ry="${radius}" fill="black"/>
    </mask>
    <!-- Window drawing with a hole punched at the terminal content so the recording shows through -->
    <mask id="contentHole">
      <rect width="${canvasW}" height="${canvasH}" fill="white"/>
      <rect x="${contentX}" y="${contentY}" width="${cw}" height="${ch}" fill="black"/>
    </mask>
    <clipPath id="winclip">
      <rect x="${winX}" y="${winY}" width="${windowW}" height="${windowH}" rx="${radius}" ry="${radius}"/>
    </clipPath>
    <!-- Shadow kept only outside the window outline -->
    <mask id="outside">
      <rect width="${canvasW}" height="${canvasH}" fill="white"/>
      <rect x="${winX}" y="${winY}" width="${windowW}" height="${windowH}" rx="${radius}" ry="${radius}" fill="black"/>
    </mask>
  </defs>

  <!-- macOS desktop wallpaper (hole punched at the window) -->
  <g mask="url(#winHole)">
    <image href="wallpaper.jpg" x="0" y="0" width="${canvasW}" height="${canvasH}" preserveAspectRatio="xMidYMid slice"/>
  </g>

  <!-- Terminal window shadow -->
  <g mask="url(#outside)">
    <rect x="${winX}" y="${winY}" width="${windowW}" height="${windowH}" rx="${radius}" ry="${radius}" fill="#0f172a" opacity="0.5" filter="url(#soft)"/>
  </g>

  <!-- Terminal window body: title bar + dark content padding (the recording shows through at the content area) -->
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
 * macOS desktop decoration: an app window (the recording content) with rounded corners and a
 * shadow, placed on the desktop wallpaper with no title bar, looking like an app in use on a
 * computer. Wallpaper margin is left around the window.
 */
export async function renderDesktopChrome(
  spec: BrowserChromeSpec,
  destDir: string,
): Promise<ChromeOverlay> {
  const { contentWidth: cw, contentHeight: ch } = spec;

  const s = Math.min(2.5, Math.max(1, cw / 1280));
  const margin = Math.round(56 * s); // wallpaper margin around the window
  const radius = Math.round(12 * s); // window corner radius
  const blur = Math.round(18 * s); // shadow blur radius

  const windowW = even(cw);
  const windowH = even(ch);
  // Canvas is 16:9 (same ratio as the unified output canvas, so the final scale crops/letterboxes nothing); window centered on the wallpaper
  const minW = cw + 2 * margin;
  const minH = ch + 2 * margin;
  const canvasW = even(Math.max(minW, Math.round((minH * 16) / 9)));
  const canvasH = even(Math.max(minH, Math.round((canvasW * 9) / 16)));
  const contentX = Math.round((canvasW - windowW) / 2);
  const contentY = Math.round((canvasH - windowH) / 2);

  const svg = `<svg width="${canvasW}" height="${canvasH}" viewBox="0 0 ${canvasW} ${canvasH}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="soft" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="${blur}"/>
    </filter>
    <!-- Wallpaper with a hole punched at the window so the recording shows through -->
    <mask id="hole">
      <rect width="${canvasW}" height="${canvasH}" fill="white"/>
      <rect x="${contentX}" y="${contentY}" width="${windowW}" height="${windowH}" rx="${radius}" ry="${radius}" fill="black"/>
    </mask>
  </defs>

  <!-- macOS desktop wallpaper (hole punched at the window) -->
  <g mask="url(#hole)">
    <image href="wallpaper.jpg" x="0" y="0" width="${canvasW}" height="${canvasH}" preserveAspectRatio="xMidYMid slice"/>
  </g>

  <!-- Window shadow (painted on the wallpaper, beneath the content, kept only outside the window outline) -->
  <g mask="url(#hole)">
    <rect x="${contentX}" y="${contentY}" width="${windowW}" height="${windowH}" rx="${radius}" ry="${radius}" fill="none" stroke="#0f172a" stroke-width="${blur * 2}" opacity="0.5" filter="url(#soft)"/>
  </g>
</svg>`;

  return renderOverlaySvg(svg, canvasW, canvasH, destDir, contentX, contentY, true);
}

/** Path to the official macOS (Tahoe) wallpaper asset: in the repo's assets/ directory (two levels up from dist/capture) */
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
 * SVG → PNG with an alpha channel (dimensions 1:1 with the composite canvas).
 * When a wallpaper is needed, the assets wallpaper is copied into the same directory and the HTML
 * references it via a file:// relative path (same-origin loadable, fast to decode).
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
    // Wait for the wallpaper image to decode before screenshotting
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
