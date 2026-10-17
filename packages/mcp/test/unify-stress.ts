/**
 * Stress / edge-case tests for the unified 1920×1080 output scheme:
 * covers extreme viewports, odd dimensions, oversized content, device pixel ratios, fit=native,
 * navigation mid-recording, second recordings, ultra-short recordings, closing a session without
 * stop, and other abnormal paths.
 *
 * Run: pnpm test:unify (build first, then tsx test/unify-stress.ts)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../src/server.js';
import { outputDir } from '../src/util/media.js';
import { getBrowser } from '../src/capture/browser.js';
import { Recorder } from '../src/capture/recorder.js';

type Content = { type: string; text?: string; data?: string };

const require = createRequire(import.meta.url);
const FIXTURES = path.resolve('test/fixtures');
const FFMPEG = require('ffmpeg-static') as string;

const { server, store } = createServer();
const client = new Client({ name: 'manta-show-unify-stress', version: '0.0.0' });
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

let failed = 0;
async function step(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`  ✗ ${name}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function call(name: string, args: Record<string, unknown> = {}): Promise<Content[]> {
  const res = (await client.callTool({ name, arguments: args })) as {
    isError?: boolean;
    content: Content[];
  };
  if (res.isError) {
    throw new Error(
      `${name} 返回错误：${res.content.map((c) => c.text ?? '').join(' | ').slice(0, 500)}`,
    );
  }
  return res.content;
}

function sessionIdOf(contents: Content[]): string {
  const text = contents.map((c) => c.text ?? '').join('\n');
  const m = text.match(/sessionId=([\w-]+)/);
  if (!m) throw new Error(`返回体中没有 sessionId：${text.slice(0, 200)}`);
  return m[1];
}

/** Extract the video path from a stop tool result body */
function videoPathOf(contents: Content[]): string {
  const file = /视频已生成：(.+)/.exec(contents.map((c) => c.text ?? '').join('\n'))?.[1];
  if (!file) throw new Error(`返回体中没有视频路径：${contents.map((c) => c.text ?? '').join(' | ').slice(0, 200)}`);
  return file;
}

/** Parse video width/height and codec via ffmpeg -i */
function probeVideo(file: string): { w: number; h: number; h264: boolean; durationSec: number } {
  let info = '';
  try {
    info = execFileSync(FFMPEG, ['-hide_banner', '-i', file], { stdio: 'pipe' }).toString();
  } catch (e) {
    info = (e as { stderr?: Buffer }).stderr?.toString() ?? '';
  }
  const dim = /(\d{2,5})x(\d{2,5})/.exec(info.match(/Stream #0:0.*Video:.*/)?.[0] ?? '');
  const dur = /Duration: (\d+):(\d+):(\d+\.\d+)/.exec(info);
  if (!dim || !dur) throw new Error(`mp4 无法解析：${file}\n${info.slice(-400)}`);
  return {
    w: Number(dim[1]),
    h: Number(dim[2]),
    h264: info.includes('h264'),
    durationSec: Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]),
  };
}

/** Assert the unified canvas: 1920×1080 / h264 / minimum duration */
function expectCanvas(file: string, label: string, minSec = 0.5): void {
  const v = probeVideo(file);
  if (!v.h264) throw new Error(`${label} 不是 H.264`);
  if (v.durationSec < minSec) throw new Error(`${label} 时长过短：${v.durationSec.toFixed(2)}s`);
  if (v.w !== 1920 || v.h !== 1080) throw new Error(`${label} 尺寸不是 1920×1080，而是 ${v.w}×${v.h}`);
  console.log(`    → ${label}: ${v.w}×${v.h}, ${v.durationSec.toFixed(2)}s, ${(fs.statSync(file).size / 1024).toFixed(0)} KB`);
}

/** Extract the RGB pixel at a coordinate from the first frame (rawvideo) to verify the letterbox color; width is the video width (default unified canvas 1920) */
function pixelAt(file: string, x: number, y: number, width = 1920): [number, number, number] {
  const tmp = path.join(os.tmpdir(), `manta-unify-pixel-${process.pid}.raw`);
  try {
    execFileSync(FFMPEG, ['-y', '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', tmp], {
      stdio: 'pipe',
    });
    const buf = fs.readFileSync(tmp);
    const off = (y * width + x) * 3;
    return [buf[off], buf[off + 1], buf[off + 2]];
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

const isWhite = ([r, g, b]: [number, number, number]) => r > 235 && g > 235 && b > 235;
const isBlack = ([r, g, b]: [number, number, number]) => r < 26 && g < 26 && b < 26;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const pageUrl = 'file://' + path.join(FIXTURES, 'page.html');

/**
 * Open a web session, run the test case, and close it regardless of success or failure,
 * so a failing case can't leak a still-recording session and drag down later cases
 * (the 15fps sampling loop is resource-hungry).
 */
async function withWebSession(
  openArgs: Record<string, unknown>,
  fn: (id: string) => Promise<void>,
): Promise<void> {
  const id = sessionIdOf(await call('browser_open', openArgs));
  try {
    await fn(id);
  } finally {
    await call('browser_close', { sessionId: id }).catch(() => {});
  }
}

console.log('\n== Web：极端视口与补边 ==');
{
  await step('最小视口 200×200 → 1920×1080，角落白色补边', async () => {
    await withWebSession({ url: pageUrl, width: 200, height: 200 }, async (id) => {
      await call('browser_record_start', { sessionId: id });
      await sleep(1500);
      const file = videoPathOf(await call('browser_record_stop', { sessionId: id }));
      expectCanvas(file, 'viewport-min.mp4');
      const px = pixelAt(file, 4, 4);
      if (!isWhite(px)) throw new Error(`浏览器补边应为白色，实测 rgb(${px.join(',')})`);
    });
  });

  await step('竖屏视口 600×1200 → 1920×1080（左右宽白边）', async () => {
    await withWebSession({ url: pageUrl, width: 600, height: 1200 }, async (id) => {
      await call('browser_record_start', { sessionId: id });
      await sleep(1200);
      expectCanvas(videoPathOf(await call('browser_record_stop', { sessionId: id })), 'portrait.mp4');
    });
  });

  await step('超宽视口 3000×800 dsf=1 → 1920×1080（上下补边）', async () => {
    await withWebSession(
      { url: pageUrl, width: 3000, height: 800, deviceScaleFactor: 1 },
      async (id) => {
        await call('browser_record_start', { sessionId: id });
        await sleep(1200);
        expectCanvas(videoPathOf(await call('browser_record_stop', { sessionId: id })), 'ultrawide.mp4');
      },
    );
  });

  await step('deviceScaleFactor=3 → 1920×1080（录制帧为 CSS 像素，不受 dsf 影响）', async () => {
    await withWebSession(
      { url: pageUrl, width: 960, height: 540, deviceScaleFactor: 3 },
      async (id) => {
        await call('browser_record_start', { sessionId: id });
        await sleep(1200);
        expectCanvas(videoPathOf(await call('browser_record_stop', { sessionId: id })), 'dsf3.mp4');
      },
    );
  });

  await step('无装饰 + 非统一比例视口 1024×640 → 1920×1080，角落黑色补边', async () => {
    await withWebSession({ url: pageUrl, width: 1024, height: 640 }, async (id) => {
      await call('browser_record_start', { decorate: 'none', sessionId: id });
      await sleep(1200);
      const file = videoPathOf(await call('browser_record_stop', { sessionId: id }));
      expectCanvas(file, 'web-raw-canvas.mp4');
      const px = pixelAt(file, 4, 4);
      if (!isBlack(px)) throw new Error(`无装饰补边应为黑色，实测 rgb(${px.join(',')})`);
    });
  });

  await step('无装饰 + 16:9 视口 1440×810 → 满帧无补边（角落为页面内容）', async () => {
    await withWebSession({ url: pageUrl, width: 1440, height: 810 }, async (id) => {
      await call('browser_record_start', { decorate: 'none', sessionId: id });
      await sleep(1200);
      const file = videoPathOf(await call('browser_record_stop', { sessionId: id }));
      expectCanvas(file, 'web-169-fullframe.mp4');
      const px = pixelAt(file, 4, 4);
      if (isBlack(px)) throw new Error('16:9 满帧角落不应是补边黑色');
      if (isWhite(px) && pixelAt(file, 1915, 4).every((v) => v > 235)) {
        // It can only be letterboxing if the top-right corner is pure white too; the page header is a purple gradient, so a white corner means a bug
        const header = pixelAt(file, 960, 100);
        if (header.every((v) => v > 235)) throw new Error('16:9 输入不应产生补边');
      }
    });
  });

  await step('fit=native 无装饰 → 精确等于视口 CSS 尺寸 1024×640', async () => {
    await withWebSession({ url: pageUrl, width: 1024, height: 640 }, async (id) => {
      await call('browser_record_start', { decorate: 'none', sessionId: id });
      await sleep(1200);
      const file = videoPathOf(await call('browser_record_stop', { fit: 'native', sessionId: id }));
      const v = probeVideo(file);
      if (v.w !== 1024 || v.h !== 640) throw new Error(`native 应为 1024×640，实测 ${v.w}×${v.h}`);
      console.log(`    → native: ${v.w}×${v.h}（原始 CSS 尺寸保留）`);
    });
  });

  await step('fit=native 带装饰 → 精确等于窗框画布尺寸 1028×696', async () => {
    await withWebSession({ url: pageUrl, width: 1024, height: 640 }, async (id) => {
      await call('browser_record_start', { sessionId: id });
      await sleep(1200);
      const file = videoPathOf(await call('browser_record_stop', { fit: 'native', sessionId: id }));
      const v = probeVideo(file);
      // Content 1024×640 + bezel 2×2 + title bar 52 (s=1) → 1028×696
      if (v.w !== 1028 || v.h !== 696) throw new Error(`native 装饰画布应为 1028×696，实测 ${v.w}×${v.h}`);
      console.log(`    → native: ${v.w}×${v.h}（窗框画布尺寸）`);
    });
  });

  await step('录制中途 browser_navigate（CDP 瞬态失败路径）→ 仍产出有效 1920×1080', async () => {
    await withWebSession({ url: pageUrl }, async (id) => {
      await call('browser_record_start', { sessionId: id });
      await sleep(800);
      await call('browser_navigate', { url: pageUrl, sessionId: id });
      await sleep(800);
      expectCanvas(videoPathOf(await call('browser_record_stop', { sessionId: id })), 'navigate-mid.mp4');
    });
  });

  await step('同一会话 stop 后再次 record_start/stop → 第二段仍 1920×1080', async () => {
    await withWebSession({ url: pageUrl }, async (id) => {
      await call('browser_record_start', { sessionId: id });
      await sleep(900);
      await call('browser_record_stop', { sessionId: id });
      await call('browser_record_start', { sessionId: id });
      await sleep(900);
      expectCanvas(videoPathOf(await call('browser_record_stop', { sessionId: id })), 'second-take.mp4');
    });
  });

  await step('极短录制（~300ms）→ mp4 有效且 1920×1080', async () => {
    await withWebSession({ url: pageUrl }, async (id) => {
      await call('browser_record_start', { sessionId: id });
      await sleep(300);
      expectCanvas(videoPathOf(await call('browser_record_stop', { sessionId: id })), 'short-take.mp4', 0.05);
    });
  });

  await step('录制中直接 browser_close（未 stop）→ 不崩溃，会话正常回收', async () => {
    await withWebSession({ url: pageUrl }, async (id) => {
      await call('browser_record_start', { sessionId: id });
      await sleep(500);
      // withWebSession's finally closes it again: a repeated close must be idempotent without erroring
      await call('browser_close', { sessionId: id });
    });
  });

  await step('视口底部完整性：native 高度=视口 810，底部色带在帧内（87px 表面裁切回归）', async () => {
    await withWebSession({ url: pageUrl, width: 1440, height: 810 }, async (id) => {
      // Purple on top, a 200px green band at the bottom, all fixed-position filling the viewport
      await call('browser_evaluate', {
        sessionId: id,
        script:
          `document.body.innerHTML =` +
          ` '<div style="position:fixed;inset:0 0 200px 0;background:#7c3aed"></div>'` +
          ` + '<div style="position:fixed;left:0;right:0;bottom:0;height:200px;background:#22c55e"></div>';`,
      });
      await call('browser_record_start', { decorate: 'none', sessionId: id });
      await sleep(1200);
      const file = videoPathOf(await call('browser_record_stop', { fit: 'native', sessionId: id }));
      const v = probeVideo(file);
      if (v.w !== 1440 || v.h !== 810) throw new Error(`native 应为 1440×810，实测 ${v.w}×${v.h}（不足即底部被裁切）`);
      const bottom = pixelAt(file, 720, 790, 1440);
      if (!(bottom[1] > 140 && bottom[0] < 120)) {
        throw new Error(`视口底部应为绿色色带，实测 rgb(${bottom.join(',')})`);
      }
      const top = pixelAt(file, 720, 300, 1440);
      if (!(top[2] > 160 && top[1] < 120)) {
        throw new Error(`视口上部应为紫色色带，实测 rgb(${top.join(',')})`);
      }
    });
  });

  await step('非法 fit 值被 schema 拒绝', async () => {
    let rejected = false;
    try {
      await call('browser_record_stop', { fit: 'weird' });
    } catch {
      rejected = true;
    }
    if (!rejected) throw new Error('非法 fit 值未被拒绝');
  });
}

console.log('\n== CLI：极端尺寸与奇数列 ==');
{
  /** Same as withWebSession: reclaim the pty + replay page regardless of success or failure */
  async function withCliSession(
    openArgs: Record<string, unknown>,
    fn: (id: string) => Promise<void>,
  ): Promise<void> {
    const id = sessionIdOf(await call('terminal_open', openArgs));
    try {
      await fn(id);
    } finally {
      await call('terminal_close', { sessionId: id }).catch(() => {});
    }
  }

  await step('极小终端 40×10 → 1920×1080', async () => {
    await withCliSession({ command: 'bash', args: ['-c', 'echo tiny; sleep 3'], cols: 40, rows: 10 }, async (id) => {
      await sleep(1200);
      expectCanvas(videoPathOf(await call('terminal_record_stop', { sessionId: id })), 'term-min.mp4');
    });
  });

  await step('极大终端 400×120 → 1920×1080（4420px 画布缩至统一尺寸）', async () => {
    await withCliSession({ command: 'bash', args: ['-c', 'echo huge; sleep 3'], cols: 400, rows: 120 }, async (id) => {
      await sleep(1200);
      expectCanvas(videoPathOf(await call('terminal_record_stop', { sessionId: id })), 'term-max.mp4');
    });
  });

  await step('奇数列 41×25 → 内容洞按取偶尺寸对齐，产出 1920×1080', async () => {
    await withCliSession({ command: 'bash', args: ['-c', 'echo odd-cols; sleep 3'], cols: 41, rows: 25 }, async (id) => {
      await sleep(1200);
      expectCanvas(videoPathOf(await call('terminal_record_stop', { sessionId: id })), 'term-odd.mp4');
    });
  });

  await step('无装饰终端 + 统一画布 → 1920×1080，角落黑色补边', async () => {
    await withCliSession({ command: 'bash', args: ['-c', 'echo raw; sleep 3'], decorate: 'none' }, async (id) => {
      await sleep(1200);
      const file = videoPathOf(await call('terminal_record_stop', { sessionId: id }));
      expectCanvas(file, 'term-raw-canvas.mp4');
      const px = pixelAt(file, 4, 4);
      if (!isBlack(px)) throw new Error(`终端无装饰补边应为黑色，实测 rgb(${px.join(',')})`);
    });
  });

  await step('终端视口底部完整性：rows=30 native 高度=480（底部截断回归）', async () => {
    await withCliSession(
      {
        command: 'bash',
        args: ['-c', 'for i in $(seq 1 60); do echo "scroll line $i"; done; sleep 3'],
        decorate: 'none',
      },
      async (id) => {
        await sleep(1500);
        const file = videoPathOf(await call('terminal_record_stop', { fit: 'native', sessionId: id }));
        const v = probeVideo(file);
        // 30 rows × 16px (fontSize 14 + lineHeight 1.0) = 480; clipped by the 87px surface bug it would be only 393
        if (v.h !== 480) throw new Error(`30 行终端 native 高度应为 480，实测 ${v.h}（视口底部被裁切）`);
        console.log(`    → native: ${v.w}×${v.h}（30 行全部在帧内）`);
      },
    );
  });

  await step('fit=native 终端 → 非 1920×1080，宽高为偶数', async () => {
    await withCliSession({ command: 'bash', args: ['-c', 'echo nat; sleep 3'] }, async (id) => {
      await sleep(1200);
      const file = videoPathOf(await call('terminal_record_stop', { fit: 'native', sessionId: id }));
      const v = probeVideo(file);
      if (v.w === 1920 && v.h === 1080) throw new Error('native 不应输出统一画布尺寸');
      if (v.w % 2 !== 0 || v.h % 2 !== 0) throw new Error(`native 宽高应为偶数：${v.w}×${v.h}`);
      console.log(`    → native: ${v.w}×${v.h}`);
    });
  });
}

console.log('\n== Electron：装饰与 native ==');
{
  async function withElectronSession(
    openArgs: Record<string, unknown>,
    fn: (id: string) => Promise<void>,
  ): Promise<void> {
    const id = sessionIdOf(await call('electron_launch', openArgs));
    try {
      await fn(id);
    } finally {
      await call('electron_close', { sessionId: id }).catch(() => {});
    }
  }

  await step('桌面装饰 + 统一画布 → 1920×1080（壁纸铺满无黑边）', async () => {
    await withElectronSession({ app: path.join(FIXTURES, 'electron-app') }, async (id) => {
      await call('electron_record_start', { sessionId: id });
      await sleep(1200);
      const file = videoPathOf(await call('electron_record_stop', { sessionId: id }));
      expectCanvas(file, 'electron-canvas.mp4');
      const px = pixelAt(file, 4, 4);
      if (isBlack(px)) throw new Error('桌面装饰角落应为壁纸（非黑），实测接近全黑');
    });
  });

  await step('fit=native Electron → 非 1920×1080（内容区原始尺寸）', async () => {
    await withElectronSession({ app: path.join(FIXTURES, 'electron-app') }, async (id) => {
      await call('electron_record_start', { decorate: 'none', sessionId: id });
      await sleep(1200);
      const file = videoPathOf(await call('electron_record_stop', { fit: 'native', sessionId: id }));
      const v = probeVideo(file);
      if (v.w === 1920 && v.h === 1080) throw new Error('native 不应输出统一画布尺寸');
      console.log(`    → native: ${v.w}×${v.h}`);
    });
  });

  await step('录制中直接 electron_close（未 stop）→ 不崩溃', async () => {
    await withElectronSession({ app: path.join(FIXTURES, 'electron-app') }, async (id) => {
      await call('electron_record_start', { sessionId: id });
      await sleep(500);
      await call('electron_close', { sessionId: id });
    });
  });
}

console.log('\n== 尺寸突变：录制中途视口变化 ==');
{
  /**
   * Resize has no MCP tool entry point, so drive the page directly with Playwright to reproduce
   * the "frame size changes mid-recording" scenario (app-managed window resizing / responsive
   * demos, etc.).
   */
  await step('录制中途 setViewportSize → 统一画布仍 1920×1080（内容按首帧归一化）', async () => {
    const browser = await getBrowser();
    const ctx = await browser.newContext({ viewport: { width: 1024, height: 640 } });
    try {
      const page = await ctx.newPage();
      await page.goto(pageUrl, { waitUntil: 'load' });
      const rec = await Recorder.start(page, { kind: 'browser' });
      await sleep(800);
      await page.setViewportSize({ width: 640, height: 1000 }); // sudden size change
      await sleep(800);
      const file = path.join(outputDir(), 'resize-mid-canvas.mp4');
      const result = await rec.stop(file, { fit: 'canvas' });
      if (result.frameCount < 10) throw new Error(`帧数异常：${result.frameCount}`);
      expectCanvas(file, 'resize-mid-canvas.mp4');
    } finally {
      await ctx.close().catch(() => {});
    }
  });

  await step('混尺寸帧 + fit=native → 锚定首帧窗框画布 1028×696，编码不失败', async () => {
    const browser = await getBrowser();
    const ctx = await browser.newContext({ viewport: { width: 1024, height: 640 } });
    try {
      const page = await ctx.newPage();
      await page.goto(pageUrl, { waitUntil: 'load' });
      const rec = await Recorder.start(page, { kind: 'browser' });
      await sleep(800);
      await page.setViewportSize({ width: 900, height: 720 });
      await sleep(800);
      const file = path.join(outputDir(), 'resize-mid-native.mp4');
      await rec.stop(file, { fit: 'native' });
      const v = probeVideo(file);
      // First frame 1024×640 + bezel 2×2 + title bar 52 (s=1) → 1028×696; the decoration is anchored to the first frame
      if (v.w !== 1028 || v.h !== 696) throw new Error(`native 应锚定首帧画布 1028×696，实测 ${v.w}×${v.h}`);
      console.log(`    → native: ${v.w}×${v.h}（首帧锚定）`);
    } finally {
      await ctx.close().catch(() => {});
    }
  });
}

console.log('\n== 收尾 ==');
const sessions = (
  store as unknown as { sessions: Map<string, { close(): Promise<void> }> }
).sessions;
for (const s of sessions.values()) {
  await s.close().catch(() => {});
}
client.close();

console.log(`\n产物目录：${outputDir()}`);
console.log(failed === 0 ? '\n全部通过 ✅' : `\n${failed} 项失败 ❌`);
process.exit(failed === 0 ? 0 : 1);
