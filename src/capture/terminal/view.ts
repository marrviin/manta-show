import { spawn as ptySpawn, type IPty } from 'node-pty';
import type { Page } from 'playwright';
import { createRequire } from 'node:module';
import path from 'node:path';
import { getBrowser } from '../browser.js';

const BUFFER_CAP = 200_000;

const ANSI_RE =
  /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, '');
}

/**
 * 终端回放页：一个无头 Playwright 页面里跑 xterm.js，pty 输出实时写入。
 * 视口精确对齐 .xterm-screen 的像素尺寸，避免录制画面出现黑边。
 */
export class TerminalView {
  private constructor(public page: Page) {}

  static async open(cols: number, rows: number): Promise<TerminalView> {
    const browser = await getBrowser();
    const context = await browser.newContext({ deviceScaleFactor: 2 });
    const page = await context.newPage();
    await page.setContent(
      '<!doctype html><html><head><style>' +
        'html,body{margin:0;padding:0;background:#18181b;overflow:hidden}' +
        '</style></head><body><div id="term"></div></body></html>',
    );

    const { jsPath, cssPath } = xtermAssets();
    await page.addStyleTag({ path: cssPath });
    await page.addScriptTag({ path: jsPath });

    await page.evaluate(
      ({ cols, rows }) => {
        const Terminal = (window as any).Terminal;
        const term = new Terminal({
          cols,
          rows,
          fontSize: 14,
          fontFamily: '"SF Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace',
          lineHeight: 1.0,
          letterSpacing: 0,
          cursorBlink: true,
          theme: { background: '#18181b', foreground: '#e4e4e7' },
        });
        term.open(document.getElementById('term')!);
        (window as any).__term = term;
      },
      { cols, rows },
    );

    // 用 xterm 实际渲染尺寸作为视口，逐像素对齐
    const size = await page.evaluate(() => {
      const rect = document.querySelector('.xterm-screen')!.getBoundingClientRect();
      return { w: Math.ceil(rect.width), h: Math.ceil(rect.height) };
    });
    await page.setViewportSize({ width: size.w, height: size.h });

    return new TerminalView(page);
  }

  write(data: string): void {
    if (process.env.MANTA_SHOW_DEBUG) {
      console.error(`[manta-show:debug] view.write ${data.length} bytes: ${JSON.stringify(data.slice(0, 40))}`);
    }
    void this.page
      .evaluate((d) => (window as any).__term.write(d), data)
      .catch((e) => {
        if (process.env.MANTA_SHOW_DEBUG) console.error('[manta-show:debug] view.write 失败:', e?.message ?? e);
      });
  }

  async close(): Promise<void> {
    await this.page.context().close().catch(() => {});
  }
}

function xtermAssets(): { jsPath: string; cssPath: string } {
  const require = createRequire(import.meta.url);
  const jsPath = require.resolve('@xterm/xterm'); // .../node_modules/@xterm/xterm/lib/xterm.js
  const root = path.dirname(path.dirname(jsPath));
  return { jsPath, cssPath: path.join(root, 'css', 'xterm.css') };
}

/** pty 会话：封装 node-pty，维护输出环形缓冲（供 terminal_read）并转发给回放页 */
export class PtySession {
  view: TerminalView | null = null;
  exited = false;
  exitCode: number | null = null;
  private exitPromise: Promise<number>;
  private buffer = '';
  private pending = '';
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(public pty: IPty) {
    pty.onData((d: string) => this.feed(d));
    this.exitPromise = new Promise<number>((resolve) => {
      pty.onExit(({ exitCode }) => {
        this.exited = true;
        this.exitCode = exitCode;
        resolve(exitCode);
      });
    });
  }

  private feed(d: string): void {
    this.buffer = (this.buffer + d).slice(-BUFFER_CAP);
    this.pending += d;
    // 16ms 批量刷新，避免高频 evaluate 往返
    this.flushTimer ??= setTimeout(() => {
      this.flushTimer = null;
      const chunk = this.pending;
      this.pending = '';
      this.view?.write(chunk);
    }, 16);
    this.flushTimer.unref?.();
  }

  write(data: string): void {
    this.pty.write(data);
  }

  async waitExit(timeoutMs: number): Promise<number> {
    if (this.exited) return this.exitCode!;
    const timeout = new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), timeoutMs));
    const result = await Promise.race([this.exitPromise.then((code) => ({ code })), timeout]);
    return result === 'timeout' ? -1 : (result as { code: number }).code;
  }

  /** SIGINT → 等待退出 → 强杀，返回退出码 */
  async stop(): Promise<number> {
    if (!this.exited) {
      this.pty.write('\x03');
      const code = await this.waitExit(3000);
      if (code === -1 && !this.exited) this.pty.kill();
      await this.waitExit(1000);
    }
    return this.exitCode ?? 0;
  }

  async dispose(): Promise<void> {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    if (!this.exited) {
      this.pty.kill();
      await this.waitExit(1000);
    }
  }

  /** 最近 N 行渲染后的纯文本，供 Agent 读取输出 */
  recentText(lines: number): string {
    const plain = stripAnsi(this.buffer);
    const all = plain.replace(/\r/g, '').split('\n');
    const tail = all.slice(-lines).join('\n');
    return tail.replace(/\n{3,}/g, '\n\n').trim() || '(暂无输出)';
  }
}

const KEY_MAP: Record<string, string> = {
  enter: '\r',
  return: '\r',
  tab: '\t',
  esc: '\x1b',
  escape: '\x1b',
  space: ' ',
  backspace: '\x7f',
  delete: '\x1b[3~',
  up: '\x1b[A',
  down: '\x1b[B',
  right: '\x1b[C',
  left: '\x1b[D',
  home: '\x1b[H',
  end: '\x1b[F',
  pageup: '\x1b[5~',
  pagedown: '\x1b[6~',
  'ctrl+a': '\x01',
  'ctrl+c': '\x03',
  'ctrl+d': '\x04',
  'ctrl+e': '\x05',
  'ctrl+k': '\x0b',
  'ctrl+l': '\x0c',
  'ctrl+u': '\x15',
  'ctrl+w': '\x17',
  'ctrl+z': '\x1a',
};

export function mapKey(name: string): string | null {
  return KEY_MAP[name.toLowerCase()] ?? null;
}
