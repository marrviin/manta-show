import { copyFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { t } from '../i18n/index.js';
import { getBrowser } from '../targets/browser.js';

export type RecordDecoration =
  | { kind: 'browser' }
  | { kind: 'terminal'; canvas?: { width: number; height: number } }
  | { kind: 'desktop' };

export interface BrowserChromeSpec {
  /** Content frame dimensions (device pixels) */
  contentWidth: number;
  contentHeight: number;
  /**
   * Pre-planned composite canvas (device px) + toolbar height, from planBrowserCanvas. When set,
   * the window is rendered on this fixed canvas instead of being sized from content + chrome,
   * so the final video composes 1:1 with no scaling and no letterbox.
   */
  canvas?: { width: number; height: number; barHeight: number };
}

export interface TerminalChromeSpec {
  contentWidth: number;
  contentHeight: number;
  /**
   * Fixed composite canvas (device px) from planTerminalLayout: the window is centered on this
   * canvas and any sub-cell remainder shows as wallpaper, instead of the canvas being derived
   * from content + chrome. Requires the window to fit (guards below fall back to derived size).
   */
  canvas?: { width: number; height: number };
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
/** Round down to even: ffmpeg's pad truncates x/y offsets to chroma-subsample alignment (even) for
 * yuv420p, so an odd content offset silently shifts the frame 1px, exposing a 1px pad-color seam
 * at the content hole's right/bottom edge. Content offsets must be even to match. */
const evenDown = (n: number) => n - (n % 2);

export interface BrowserCanvasPlan {
  /** Viewport (CSS px) to set on the page before recording; at capture scale 1 frame px == CSS px */
  viewport: { width: number; height: number };
  /** Content frame dimensions (device px, even) */
  contentWidth: number;
  contentHeight: number;
  canvasWidth: number;
  canvasHeight: number;
  barHeight: number;
}

/**
 * Solve for the content size whose window chrome (bezel + toolbar) composes to exactly
 * canvasW×canvasH, so a web recording fills the 16:9 output 1:1 — no scaling, no letterbox bars.
 * The chrome scale factor derives from the content width, so s is the fixed point of
 * s = clamp((canvasW − 2·bezel)/1280); a few iterations converge. Any odd-pixel remainder of the
 * content height is absorbed into the toolbar so every dimension stays even (yuv420p).
 */
export function planBrowserCanvas(canvasW: number, canvasH: number): BrowserCanvasPlan {
  let s = 1.5;
  for (let i = 0; i < 6; i++) {
    s = Math.min(2.5, Math.max(1, (canvasW - 2 * Math.max(2, Math.round(2 * s))) / 1280));
  }
  const bezel = Math.max(2, Math.round(2 * s));
  const cw = canvasW - 2 * bezel; // even when canvasW is
  const ch0 = canvasH - Math.round(52 * s) - 2 * bezel;
  const ch = ch0 - (ch0 % 2);
  const barH = canvasH - ch - 2 * bezel; // even: even − even − even
  return {
    viewport: { width: cw, height: ch },
    contentWidth: cw,
    contentHeight: ch,
    canvasWidth: canvasW,
    canvasHeight: canvasH,
    barHeight: barH,
  };
}

/**
 * Pick the largest cols×rows whose chrome (wallpaper margin + title bar + padding) composes to
 * exactly canvasW×canvasH, so a decorated terminal recording renders 1:1 with no scaling. The
 * chrome scale factor derives from the content width, so s is the fixed point of
 * s = clamp((canvasW − 2·margin − 2·pad)/1280); a few iterations converge. Cell quantization
 * floors cols/rows to whole characters — the sub-cell remainder shows as wallpaper.
 */
export function planTerminalLayout(
  canvasW: number,
  canvasH: number,
  cell: { w: number; h: number },
): { cols: number; rows: number } {
  if (cell.w <= 0 || cell.h <= 0) throw new Error('invalid terminal cell size');
  let s = 1.5;
  for (let i = 0; i < 8; i++) {
    s = Math.min(2.5, Math.max(1, (canvasW - 2 * Math.round(56 * s) - 2 * Math.round(16 * s)) / 1280));
  }
  const margin = Math.round(56 * s); // wallpaper margin around the window
  const pad = Math.round(16 * s); // dark padding around the terminal content
  const titleBarH = Math.round(44 * s);
  return {
    cols: Math.max(40, Math.floor((canvasW - 2 * margin - 2 * pad) / cell.w)),
    rows: Math.max(10, Math.floor((canvasH - 2 * margin - titleBarH - 2 * pad) / cell.h)),
  };
}

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
  const barH = spec.canvas ? spec.canvas.barHeight : Math.round(52 * s); // toolbar height
  const radius = Math.round(10 * s); // window corner radius
  const dotR = Math.round(7 * s); // traffic light radius
  const dotGap = Math.round(22 * s);

  const windowW = spec.canvas ? spec.canvas.width : even(cw + 2 * bezel);
  const windowH = spec.canvas ? spec.canvas.height : even(barH + ch + 2 * bezel);
  const canvasW = windowW;
  const canvasH = windowH;
  const contentX = evenDown(bezel);
  const contentY = evenDown(barH + bezel);

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
  // Fixed pre-planned canvas when the terminal layout was planned to fill it; otherwise derive a
  // 16:9 canvas from content + chrome (window centered on the wallpaper either way)
  const fits =
    spec.canvas !== undefined &&
    spec.canvas.width >= windowW + 2 &&
    spec.canvas.height >= windowH + 2;
  const canvasW = fits ? spec.canvas!.width : even(Math.max(windowW + 2 * margin, Math.round(((windowH + 2 * margin) * 16) / 9)));
  const canvasH = fits ? spec.canvas!.height : even(Math.max(windowH + 2 * margin, Math.round((canvasW * 9) / 16)));
  // Even offsets (see evenDown); the padding rects derive from them so the hole and the pad
  // placement always agree
  const winX = evenDown(Math.round((canvasW - windowW) / 2));
  const winY = evenDown(Math.round((canvasH - windowH) / 2));
  const contentX = evenDown(winX + pad);
  const contentY = evenDown(winY + titleBarH + pad);
  const padL = contentX - winX;
  const padR = winX + windowW - (contentX + cw);
  const padT = contentY - (winY + titleBarH);
  const padB = winY + windowH - (contentY + ch);

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

  <!-- Terminal window body: title bar + dark content padding, assembled from explicit rects.
       No content-hole mask here: mask edge antialiasing leaks ~1px of the window fill into the
       hole (a white seam on the dark terminal). Axis-aligned rects rasterize pixel-exact, and any
       sub-pixel spill is dark-over-dark, invisible. The content area itself is left untouched. -->
  <g clip-path="url(#winclip)">
    <rect x="${winX}" y="${winY}" width="${windowW}" height="${titleBarH}" fill="#f6f6f7"/>
    <line x1="0" y1="${winY + titleBarH - 1}" x2="${canvasW}" y2="${winY + titleBarH - 1}" stroke="#e2e4e9" stroke-width="${Math.max(1, s)}"/>
    <circle cx="${winX + dotR + 18 * s}" cy="${winY + titleBarH / 2}" r="${dotR}" fill="#ff5f57"/>
    <circle cx="${winX + dotR + 18 * s + dotGap}" cy="${winY + titleBarH / 2}" r="${dotR}" fill="#febc2e"/>
    <circle cx="${winX + dotR + 18 * s + 2 * dotGap}" cy="${winY + titleBarH / 2}" r="${dotR}" fill="#28c840"/>
    <rect x="${winX}" y="${winY + titleBarH}" width="${windowW}" height="${padT}" fill="#18181b"/>
    <rect x="${winX}" y="${contentY}" width="${padL}" height="${ch}" fill="#18181b"/>
    <rect x="${contentX + cw}" y="${contentY}" width="${padR}" height="${ch}" fill="#18181b"/>
    <rect x="${winX}" y="${contentY + ch}" width="${windowW}" height="${padB}" fill="#18181b"/>
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
  const contentX = evenDown(Math.round((canvasW - windowW) / 2));
  const contentY = evenDown(Math.round((canvasH - windowH) / 2));

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
    throw new Error(t('decoration.renderFail', { message: e instanceof Error ? e.message : String(e) }));
  } finally {
    await rm(htmlPath, { force: true }).catch(() => {});
    if (withWallpaper) await rm(path.join(destDir, 'wallpaper.jpg'), { force: true }).catch(() => {});
  }
  return { pngPath, contentX, contentY, canvasWidth: canvasW, canvasHeight: canvasH };
}
