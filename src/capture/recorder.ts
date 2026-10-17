import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { CDPSession, Page } from 'playwright';
import { locateFfmpeg, runFfmpeg } from './ffmpeg.js';
import {
  renderBrowserChrome,
  renderDesktopChrome,
  renderTerminalChrome,
  type RecordDecoration,
} from './chrome.js';

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

/** 单次截图超时：页面导航期间 captureScreenshot 可能无限挂起（等稳定帧与导航竞争） */
const SHOT_TIMEOUT_MS = 5_000;
/** 连续超时上限：超过后判定页面不可采，停止采集循环（保住 stop 流程不挂死） */
const MAX_CONSECUTIVE_TIMEOUTS = 6;

/** 三类录制（web / 终端 / Electron）统一输出的画布尺寸（16:9） */
export const OUTPUT_WIDTH = 1920;
export const OUTPUT_HEIGHT = 1080;

export type RecordFit = 'canvas' | 'native';

/** 统一画布的补边底色：浏览器窗框白底、终端深色底，其余用黑 */
function letterboxColor(decoration: RecordDecoration | null): string {
  if (decoration?.kind === 'browser') return '#ffffff';
  if (decoration?.kind === 'terminal') return '#18181b';
  return '#000000';
}

/** 解析 JPEG 帧的像素尺寸（SOF 段），无需 ffprobe */
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
 * 统一录制器：通过 CDP Page.captureScreenshot 定时全帧采样（web 页 / Electron 窗口 / 终端回放页通用），
 * stop 时按帧时间戳用 ffmpeg 合成 mp4 (H.264, yuv420p)。
 *
 * 不用 Page.startScreencast：无头模式下各实现的合成器行为不可靠
 * （headless shell 不持续出帧、新无头会推局部损坏帧），轮询全帧截图最稳。
 * 不用 context recordVideo：它只在关闭整个 context 时落盘，无法支持会话中途 start/stop。
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

  private constructor() {}

  static async start(page: Page, decoration: RecordDecoration | null = null): Promise<Recorder> {
    const ffmpeg = await locateFfmpeg();
    if (!ffmpeg) {
      throw new Error(
        '未找到 ffmpeg，无法录制视频。请安装 ffmpeg（brew install ffmpeg）或通过 MANTA_SHOW_FFMPEG 指定路径。',
      );
    }

    const rec = new Recorder();
    rec.page = page;
    rec.decoration = decoration;
    rec.tmpDir = await mkdtemp(path.join(os.tmpdir(), 'manta-show-rec-'));
    rec.cdp = await page.context().newCDPSession(page);
    rec.stopped = false;
    rec.startedAt = Date.now();
    rec.loop = rec.captureLoop();
    return rec;
  }

  /** 单次截图，带超时；超时视为采集卡死 */
  private shot(): Promise<{ data: string } | 'timeout'> {
    // 新版无头 Chromium（channel: 'chromium'）的窗口合成表面比视口矮约 87px（浏览器 UI 占位），
    // 且时有时无，直接截图会随机截掉底部一条（终端表现为最后一行被切半、看似不滚动）。
    // 显式 clip + captureBeyondViewport 离屏渲染完整视口，保证帧内容与视口逐像素一致。
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

  /** 采集卡死自愈：丢弃挂起的 CDP 会话并重建，下一拍继续采 */
  private async recoverCdp(): Promise<void> {
    await this.cdp.detach().catch(() => {});
    this.cdp = await this.page.context().newCDPSession(this.page);
  }

  private async captureLoop(): Promise<void> {
    let consecutiveTimeouts = 0;
    while (!this.stopped) {
      const t0 = Date.now();
      try {
        const shot = await this.shot();
        if (this.stopped) break;
        if (shot === 'timeout') {
          // 挂起的请求留着无害；重建会话避免后续截图排队在同一卡死的 target 上
          await this.recoverCdp().catch(() => {});
          if (++consecutiveTimeouts >= MAX_CONSECUTIVE_TIMEOUTS) break; // 页面不可采，放弃采集
        } else {
          consecutiveTimeouts = 0;
          const file = path.join(this.tmpDir, `${String(++this.seq).padStart(6, '0')}.jpg`);
          this.frames.push({ file, ts: Date.now() });
          await writeFile(file, Buffer.from(shot.data, 'base64'));
        }
      } catch {
        // 页面跳转等瞬态失败：跳过这一拍
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
    }

    try {
      if (this.frames.length === 0) {
        throw new Error('没有捕获到任何画面帧。请确认录制窗口内有交互或动画后重试。');
      }

      // concat 清单：每帧带 duration（由相邻帧时间戳推导），末帧重复一次是 concat demuxer 的要求
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

      // 扫描各帧尺寸：录制中途窗口/视口变化会产生混尺寸帧，x264 要求恒定分辨率，
      // 需要先把所有帧归一化到首帧画幅（等比缩放 + 居中补边）
      const firstSize = jpegSize(this.frames[0].file);
      const mixedSize =
        firstSize !== null &&
        this.frames.some((f) => {
          const s = jpegSize(f.file);
          return s === null || s.width !== firstSize.width || s.height !== firstSize.height;
        });

      // 第一步：原始帧 → 内容 mp4
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
        // 采样间隔抖动用 fps 归一化；宽高取偶数满足 yuv420p/x264 要求
        '-vf', sampleFilter,
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-crf', '23',
        '-movflags', '+faststart',
        rawPath,
      ]);

      // 统一输出 1920×1080：等比缩放后居中补边（fit=native 时保持原始尺寸）
      const unify = (color: string) =>
        `scale=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:force_original_aspect_ratio=decrease,` +
        `pad=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=${color},format=yuv420p`;

      // 第二步（可选）：叠加窗框装饰
      if (this.decoration) {
        if (!firstSize) throw new Error('无法解析录制帧尺寸，跳过窗框装饰');
        // 第一遍编码时宽高被 trunc 取偶，装饰画布的内容洞必须按取偶后的尺寸对齐，
        // 否则奇数尺寸内容（如奇数列的终端）会在右/下边缘露出 1px 底色缝
        const evenSize = {
          contentWidth: firstSize.width - (firstSize.width % 2),
          contentHeight: firstSize.height - (firstSize.height % 2),
        };
        const overlay =
          this.decoration.kind === 'browser'
            ? await renderBrowserChrome(evenSize, this.tmpDir)
            : this.decoration.kind === 'terminal'
              ? await renderTerminalChrome(evenSize, this.tmpDir)
              : await renderDesktopChrome(evenSize, this.tmpDir);
        try {
          const vf =
            `[0:v]pad=${overlay.canvasWidth}:${overlay.canvasHeight}:${overlay.contentX}:${overlay.contentY}:color=white[p];` +
            `[p][1:v]overlay=0:0${fit === 'canvas' ? `,${unify(letterboxColor(this.decoration))}` : ',format=yuv420p'}[v]`;
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

  /** 丢弃录制（不产出文件），用于启动后、stop 前的失败清理 */
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
