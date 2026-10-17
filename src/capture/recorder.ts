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
    rec.decoration = decoration;
    rec.tmpDir = await mkdtemp(path.join(os.tmpdir(), 'manta-show-rec-'));
    rec.cdp = await page.context().newCDPSession(page);
    rec.stopped = false;
    rec.startedAt = Date.now();
    rec.loop = rec.captureLoop();
    return rec;
  }

  private async captureLoop(): Promise<void> {
    while (!this.stopped) {
      const t0 = Date.now();
      try {
        const { data } = (await this.cdp.send('Page.captureScreenshot', {
          format: 'jpeg',
          quality: 85,
        })) as { data: string };
        if (this.stopped) break;
        const file = path.join(this.tmpDir, `${String(++this.seq).padStart(6, '0')}.jpg`);
        this.frames.push({ file, ts: Date.now() });
        await writeFile(file, Buffer.from(data, 'base64'));
      } catch {
        // 页面跳转等瞬态失败：跳过这一拍
      }
      const elapsed = Date.now() - t0;
      await new Promise((r) => setTimeout(r, Math.max(10, SAMPLE_INTERVAL_MS - elapsed)));
    }
  }

  async stop(outputPath: string): Promise<RecordResult> {
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

      // 第一步：原始帧 → 内容 mp4
      const rawPath = path.join(this.tmpDir, 'raw.mp4');
      await runFfmpeg([
        '-f', 'concat',
        '-safe', '0',
        '-i', listPath,
        // 采样间隔抖动用 fps 归一化；宽高取偶数满足 yuv420p/x264 要求
        '-vf', 'fps=15,scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p',
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-crf', '23',
        '-movflags', '+faststart',
        rawPath,
      ]);

      // 第二步（可选）：叠加窗框装饰
      if (this.decoration) {
        const size = jpegSize(this.frames[0].file);
        if (!size) throw new Error('无法解析录制帧尺寸，跳过窗框装饰');
        const overlay =
          this.decoration.kind === 'browser'
            ? await renderBrowserChrome({ contentWidth: size.width, contentHeight: size.height }, this.tmpDir)
            : this.decoration.kind === 'terminal'
              ? await renderTerminalChrome(
                  { contentWidth: size.width, contentHeight: size.height },
                  this.tmpDir,
                )
              : await renderDesktopChrome(
                  { contentWidth: size.width, contentHeight: size.height },
                  this.tmpDir,
                );
        try {
          const filter =
            `[0:v]pad=${overlay.canvasWidth}:${overlay.canvasHeight}:${overlay.contentX}:${overlay.contentY}:color=white[p];` +
            `[p][1:v]overlay=0:0,format=yuv420p[v]`;
          await runFfmpeg([
            '-i', rawPath,
            '-i', overlay.pngPath,
            '-filter_complex', filter,
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
