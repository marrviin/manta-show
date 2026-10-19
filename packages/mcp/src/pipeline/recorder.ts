import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { CDPSession, Page } from 'playwright';
import { t } from '../i18n/index.js';
import { FFMPEG_MISSING_MESSAGE, locateFfmpeg } from '../deps/ffmpeg.js';
import { runFfmpeg } from './encode.js';
import {
  planBrowserCanvas,
  renderBrowserChrome,
  renderDesktopChrome,
  renderTerminalChrome,
  type BrowserCanvasPlan,
  type BrowserChromeSpec,
  type ChromeOverlay,
  type RecordDecoration,
} from './decoration.js';

interface Frame {
  file: string;
  ts: number;
}

export interface RecordResult {
  outputPath: string;
  durationSec: number;
  frameCount: number;
}

const SAMPLE_INTERVAL_MS = 66; // ≈15fps

/** Per-screenshot timeout: captureScreenshot can hang indefinitely during page navigation (waiting for a stable frame races with navigation) */
const SHOT_TIMEOUT_MS = 5_000;
/** Consecutive timeout limit: beyond it the page is deemed un-capturable and the capture loop stops (keeps the stop flow from hanging) */
const MAX_CONSECUTIVE_TIMEOUTS = 6;

/** Unified output canvas size (16:9) for all three recording kinds (web / terminal / Electron) */
export const OUTPUT_WIDTH = 1920;
export const OUTPUT_HEIGHT = 1080;

export type RecordFit = 'canvas' | 'native';

/** Letterbox background color for the unified canvas: white for browser chrome, dark for terminal, black otherwise */
function letterboxColor(decoration: RecordDecoration | null): string {
  if (decoration?.kind === 'browser') return '#ffffff';
  if (decoration?.kind === 'terminal') return '#18181b';
  return '#000000';
}

/** Parse the pixel dimensions of a JPEG frame (SOF segment), no ffprobe needed */
function jpegSize(file: string): { width: number; height: number } | null {
  const buf = readFileSync(file);
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = buf[i + 1];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    const len = buf.readUInt16BE(i + 2);
    if (len < 2) return null;
    i += 2 + len;
  }
  return null;
}

/**
 * Unified recorder: samples full frames at a fixed interval via CDP Page.captureScreenshot
 * (works for web pages / Electron windows / the terminal replay page); on stop, assembles the
 * frames into an mp4 (H.264, yuv420p) with ffmpeg using frame timestamps.
 *
 * Page.startScreencast is not used: compositor behavior across headless implementations is
 * unreliable (headless shell doesn't produce frames continuously, new headless pushes partially
 * corrupted frames) — polling full-frame screenshots is the most robust.
 * context recordVideo is not used: it only flushes to disk when the whole context closes, so it
 * can't support mid-session start/stop.
 */
export class Recorder {
  private page!: Page;
  private cdp!: CDPSession;
  private tmpDir = '';
  private frames: Frame[] = [];
  private seq = 0;
  private startedAt = 0;
  private stopped = true;
  private loop: Promise<void> = Promise.resolve();
  private decoration: RecordDecoration | null = null;
  private cursor = false;
  /** Browser-decoration viewport plan (content + chrome composes to exactly OUTPUT_W×OUTPUT_H) */
  private plan: BrowserCanvasPlan | null = null;
  private originalViewport: { width: number; height: number } | null = null;

  private constructor() {}

  static async start(
    page: Page,
    decoration: RecordDecoration | null = null,
    opts: { cursor?: boolean } = {},
  ): Promise<Recorder> {
    const ffmpeg = await locateFfmpeg();
    if (!ffmpeg) throw new Error(FFMPEG_MISSING_MESSAGE);

    const rec = new Recorder();
    rec.page = page;
    rec.decoration = decoration;
    rec.cursor = opts.cursor ?? false;
    rec.tmpDir = await mkdtemp(path.join(os.tmpdir(), 'manta-show-rec-'));
    rec.cdp = await page.context().newCDPSession(page);
    rec.stopped = false;
    rec.startedAt = Date.now();

    // Browser decoration: pre-plan the viewport so window chrome + content compose to exactly
    // 1920×1080 (frame px == CSS px at capture scale 1). The first captured frame verifies the
    // mapping at stop time; a mismatch falls back to the fit-and-letterbox path.
    if (decoration?.kind === 'browser') {
      rec.originalViewport = page.viewportSize();
      rec.plan = planBrowserCanvas(OUTPUT_WIDTH, OUTPUT_HEIGHT);
      await page.setViewportSize(rec.plan.viewport);
    }

    rec.loop = rec.captureLoop();
    return rec;
  }

  /** Single screenshot with a timeout; a timeout is treated as a stalled capture */
  private shot(): Promise<{ data: string } | 'timeout'> {
    // New headless Chromium (channel: 'chromium') has a window compositing surface ~87px shorter
    // than the viewport (browser UI placeholder), and it comes and goes; a direct screenshot
    // randomly cuts off a strip at the bottom (for the terminal the last line gets halved and
    // appears not to scroll).
    // An explicit clip + captureBeyondViewport renders the full viewport offscreen, guaranteeing
    // frame content matches the viewport pixel for pixel.
    const viewport = this.page.viewportSize();
    const params = viewport
      ? {
          format: 'jpeg' as const,
          quality: 85,
          clip: { x: 0, y: 0, width: viewport.width, height: viewport.height, scale: 1 },
          captureBeyondViewport: true,
        }
      : { format: 'jpeg' as const, quality: 85 };
    const race = Promise.race([
      this.cdp.send('Page.captureScreenshot', params) as Promise<{ data: string }>,
      new Promise<'timeout'>((r) => {
        const t = setTimeout(() => r('timeout'), SHOT_TIMEOUT_MS);
        t.unref?.();
      }),
    ]);
    return race;
  }

  /** Capture-stall self-healing: drop the pending CDP session and rebuild it, then keep capturing on the next tick */
  private async recoverCdp(): Promise<void> {
    await this.cdp.detach().catch(() => {});
    this.cdp = await this.page.context().newCDPSession(this.page);
  }

  /**
   * Synthetic cursor overlay: headless screenshots contain no real pointer, so a recorded demo
   * shows clicks as sudden state jumps. Inject a cursor div that follows mousemove and a ripple
   * on mousedown (re-injected every tick — navigation wipes the DOM).
   * Returns false on timeout (page stalled); evaluation errors propagate to the capture loop
   * as transient failures. Guarded by the same timeout as shot() — a hanging evaluate would
   * otherwise stall the capture loop before the shot-timeout self-healing can kick in.
   */
  private async ensureCursor(): Promise<boolean> {
    const inject = this.page.evaluate(() => {
      if (document.getElementById('__manta-cursor')) return;
      const style = document.createElement('style');
      style.id = '__manta-cursor-style';
      style.textContent =
        '@keyframes __mantaRipple{from{transform:translate(-50%,-50%) scale(.35);opacity:.9}' +
        'to{transform:translate(-50%,-50%) scale(1.7);opacity:0}}';
      document.documentElement.appendChild(style);

      const cursor = document.createElement('div');
      cursor.id = '__manta-cursor';
      cursor.style.cssText =
        'position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;opacity:0;transition:opacity .12s;';
      cursor.innerHTML =
        '<svg width="18" height="22" viewBox="0 0 18 22"><path d="M1.5 1 L1.5 17 L6 13.3 L8.6 19.3 L11.6 18 L9 12.1 L14 11.8 Z" ' +
        'fill="#111" fill-opacity=".92" stroke="#fff" stroke-width="1.3" stroke-linejoin="round"/></svg>';
      document.documentElement.appendChild(cursor);

      window.addEventListener(
        'mousemove',
        (e) => {
          cursor.style.opacity = '1';
          cursor.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
        },
        { capture: true, passive: true },
      );
      window.addEventListener(
        'mousedown',
        (e) => {
          const ripple = document.createElement('div');
          ripple.style.cssText =
            `position:fixed;left:${e.clientX}px;top:${e.clientY}px;width:44px;height:44px;border-radius:50%;` +
            'border:2.5px solid rgba(255,255,255,.95);' +
            'box-shadow:0 0 0 1px rgba(0,0,0,.35), inset 0 0 0 1px rgba(0,0,0,.25);' +
            'z-index:2147483646;pointer-events:none;animation:__mantaRipple .45s ease-out forwards;';
          document.documentElement.appendChild(ripple);
          ripple.addEventListener('animationend', () => ripple.remove());
        },
        { capture: true },
      );
    });
    return Promise.race([
      inject.then(() => true),
      new Promise<false>((r) => {
        const t = setTimeout(() => r(false), SHOT_TIMEOUT_MS);
        t.unref?.();
      }),
    ]);
  }

  private async captureLoop(): Promise<void> {
    let consecutiveTimeouts = 0;
    while (!this.stopped) {
      const t0 = Date.now();
      try {
        // A stalled page here counts toward the consecutive-timeout limit, same as a stalled shot
        if (this.cursor && !(await this.ensureCursor())) {
          await this.recoverCdp().catch(() => {});
          if (++consecutiveTimeouts >= MAX_CONSECUTIVE_TIMEOUTS) break;
          continue;
        }
        const shot = await this.shot();
        if (this.stopped) break;
        if (shot === 'timeout') {
          // Leaving the hung request pending is harmless; rebuild the session so later screenshots don't queue on the same stuck target
          await this.recoverCdp().catch(() => {});
          if (++consecutiveTimeouts >= MAX_CONSECUTIVE_TIMEOUTS) break; // page un-capturable, give up capturing
        } else {
          consecutiveTimeouts = 0;
          const ts = Date.now();
          const file = path.join(this.tmpDir, `${String(++this.seq).padStart(6, '0')}.jpg`);
          await writeFile(file, Buffer.from(shot.data, 'base64'));
          // List the frame only after its file is safely on disk — a manifest entry without a
          // file would make the concat demuxer fail opaquely at stop time
          this.frames.push({ file, ts });
        }
      } catch {
        // Transient failures such as page navigation: skip this tick
      }
      const elapsed = Date.now() - t0;
      await new Promise((r) => setTimeout(r, Math.max(10, SAMPLE_INTERVAL_MS - elapsed)));
    }
  }

  async stop(outputPath: string, opts: { fit?: RecordFit } = {}): Promise<RecordResult> {
    const fit = opts.fit ?? 'canvas';
    if (!this.stopped) {
      this.stopped = true;
      await this.loop.catch(() => {});
      await this.cdp.detach().catch(() => {});
      // Recording done — give the session its original viewport back (best-effort; the page may
      // already be closed after a navigation crash)
      if (this.originalViewport) {
        const vp = this.originalViewport;
        this.originalViewport = null;
        await this.page.setViewportSize(vp).catch(() => {});
      }
    }

    try {
      if (this.frames.length === 0) {
        throw new Error(t('recorder.noFrames'));
      }

      // concat manifest: each frame carries a duration (derived from adjacent frame timestamps); repeating the last frame is a concat demuxer requirement
      const stopTs = Math.max(Date.now(), this.frames[this.frames.length - 1].ts + SAMPLE_INTERVAL_MS);
      const lines: string[] = ['ffconcat version 1.0'];
      for (let i = 0; i < this.frames.length; i++) {
        lines.push(`file '${this.frames[i].file}'`);
        const dur =
          i < this.frames.length - 1
            ? (this.frames[i + 1].ts - this.frames[i].ts) / 1000
            : Math.min(60, Math.max(0.1, (stopTs - this.frames[i].ts) / 1000));
        lines.push(`duration ${Math.max(dur, 0.02).toFixed(3)}`);
      }
      lines.push(`file '${this.frames[this.frames.length - 1].file}'`);

      const listPath = path.join(this.tmpDir, 'list.txt');
      await writeFile(listPath, lines.join('\n'));
      await mkdir(path.dirname(outputPath), { recursive: true });

      const durationSec = Math.max(0.1, (stopTs - this.frames[0].ts) / 1000);

      // Scan frame sizes: window/viewport changes mid-recording produce mixed-size frames, and
      // x264 requires a constant resolution, so all frames must first be normalized to the first
      // frame's dimensions (proportional scale + centered letterbox)
      const firstSize = jpegSize(this.frames[0].file);
      const mixedSize =
        firstSize !== null &&
        this.frames.some((f) => {
          const s = jpegSize(f.file);
          return s === null || s.width !== firstSize.width || s.height !== firstSize.height;
        });

      // Step 1: raw frames → content mp4
      const rawPath = path.join(this.tmpDir, 'raw.mp4');
      const sampleFilter = mixedSize
        ? (() => {
            const w = firstSize.width - (firstSize.width % 2);
            const h = firstSize.height - (firstSize.height % 2);
            return `fps=15,scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black,format=yuv420p`;
          })()
        : 'fps=15,scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p';
      await runFfmpeg([
        '-f', 'concat',
        '-safe', '0',
        '-i', listPath,
        // fps normalizes jitter in the sampling interval; even width/height satisfies yuv420p/x264 requirements
        '-vf', sampleFilter,
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-crf', '23',
        '-movflags', '+faststart',
        rawPath,
      ]);

      // Unified 1920×1080 output: proportional scale then centered letterbox (fit=native keeps the original size)
      const unify = (color: string) =>
        `scale=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:force_original_aspect_ratio=decrease,` +
        `pad=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=${color},format=yuv420p`;

      // Step 2 (optional): overlay the window chrome decoration
      if (this.decoration) {
        if (!firstSize) throw new Error(t('recorder.decorationSizeFail'));
        // The first encoding pass truncates width/height to even numbers, so the decoration
        // canvas's content hole must align with the evened dimensions — otherwise odd-sized
        // content (e.g. a terminal with an odd column count) shows a 1px background seam at
        // the right/bottom edges
        const evenSize = {
          contentWidth: firstSize.width - (firstSize.width % 2),
          contentHeight: firstSize.height - (firstSize.height % 2),
        };
        // Viewport was pre-planned (browser: first frame confirms the frame-px == CSS-px mapping;
        // terminal: fixed canvas with the hole rendered from the actual frame size) so the chrome
        // composes 1:1 on the output canvas — no scale, no bars
        const plan = this.plan;
        const planned =
          (this.decoration.kind === 'browser' &&
            plan !== null &&
            firstSize.width === plan.contentWidth &&
            firstSize.height === plan.contentHeight) ||
          (this.decoration.kind === 'terminal' && this.decoration.canvas !== undefined);
        let overlay: ChromeOverlay;
        if (this.decoration.kind === 'browser') {
          const spec: BrowserChromeSpec =
            planned && plan !== null
              ? {
                  contentWidth: plan.contentWidth,
                  contentHeight: plan.contentHeight,
                  canvas: {
                    width: plan.canvasWidth,
                    height: plan.canvasHeight,
                    barHeight: plan.barHeight,
                  },
                }
              : evenSize;
          overlay = await renderBrowserChrome(spec, this.tmpDir);
        } else if (this.decoration.kind === 'terminal') {
          overlay = await renderTerminalChrome(
            {
              contentWidth: evenSize.contentWidth,
              contentHeight: evenSize.contentHeight,
              canvas: this.decoration.canvas,
            },
            this.tmpDir,
          );
        } else {
          overlay = await renderDesktopChrome(evenSize, this.tmpDir);
        }
        try {
          // Offsets must be even: ffmpeg pad truncates them to chroma alignment for yuv420p, and
          // an odd offset would shift the frame 1px inside the chrome hole (see evenDown)
          const cx = overlay.contentX - (overlay.contentX % 2);
          const cy = overlay.contentY - (overlay.contentY % 2);
          // Planned compose already lands on OUTPUT_W×OUTPUT_H; otherwise canvas fit still
          // letterboxes into it (fit=native keeps the decorated native size)
          const vf =
            `[0:v]pad=${overlay.canvasWidth}:${overlay.canvasHeight}:${cx}:${cy}:color=white[p];` +
            `[p][1:v]overlay=0:0${
              planned || fit !== 'canvas'
                ? ',format=yuv420p'
                : `,${unify(letterboxColor(this.decoration))}`
            }[v]`;
          await runFfmpeg([
            '-i', rawPath,
            '-i', overlay.pngPath,
            '-filter_complex', vf,
            '-map', '[v]',
            '-c:v', 'libx264',
            '-preset', 'veryfast',
            '-crf', '23',
            '-movflags', '+faststart',
            outputPath,
          ]);
        } finally {
          await rm(path.dirname(overlay.pngPath), { recursive: true, force: true }).catch(() => {});
        }
      } else if (fit === 'canvas') {
        await runFfmpeg([
          '-i', rawPath,
          '-vf', unify(letterboxColor(null)),
          '-c:v', 'libx264',
          '-preset', 'veryfast',
          '-crf', '23',
          '-movflags', '+faststart',
          outputPath,
        ]);
      } else {
        await this.moveOrCopy(rawPath, outputPath);
      }
      return { outputPath, durationSec, frameCount: this.frames.length };
    } finally {
      await rm(this.tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  /** Discard the recording (produce no files); used for failure cleanup after start and before stop */
  async dispose(): Promise<void> {
    this.stopped = true;
    await this.loop.catch(() => {});
    if (this.cdp) await this.cdp.detach().catch(() => {});
    await rm(this.tmpDir, { recursive: true, force: true }).catch(() => {});
  }

  private async moveOrCopy(from: string, to: string): Promise<void> {
    const { rename, copyFile } = await import('node:fs/promises');
    try {
      await rename(from, to);
    } catch {
      await copyFile(from, to);
    }
  }
}
