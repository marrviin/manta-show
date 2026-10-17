import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SessionStore, type SessionBase, type SessionKind } from '../session.js';
import { PtySession, TerminalView, mapKey } from '../capture/terminal/view.js';
import { Recorder } from '../capture/recorder.js';
import { locateFfmpeg } from '../capture/ffmpeg.js';
import { spawn as ptySpawn } from 'node-pty';
import { mediaPath } from '../util/media.js';
import {
  errorResult,
  handle,
  textResult,
  videoFileResult,
} from '../util/respond.js';

export class CliSession implements SessionBase {
  kind = 'cli' as const satisfies SessionKind;
  lastUsed = Date.now();
  view: TerminalView | null = null;
  recorder: Recorder | null = null;

  constructor(
    public id: string,
    public pty: PtySession,
  ) {}

  async close(): Promise<void> {
    if (this.recorder) {
      const out = mediaPath('video', 'mp4');
      try {
        await this.recorder.stop(out);
      } catch {
        // 关闭时丢弃未完成的录制
      }
      this.recorder = null;
    }
    await this.pty.dispose();
    await this.view?.close();
  }
}

export function registerCliTools(server: McpServer, store: SessionStore): void {
  server.registerTool(
    'terminal_open',
    {
      title: '运行终端命令并开始录制',
      description:
        '在 pty 中启动一个命令行程序，同时打开 xterm.js 回放页并开始录制画面。返回 cli 会话 id。' +
        '用 terminal_read 读取输出、terminal_send 模拟交互，完成后用 terminal_record_stop 导出 mp4。',
      inputSchema: {
        command: z.string().describe('要运行的命令，如 npm、python、./my-cli'),
        args: z.array(z.string()).optional().describe('命令参数列表'),
        cwd: z.string().optional().describe('工作目录，缺省为 MCP server 启动目录'),
        cols: z.number().int().min(40).max(400).optional().default(100).describe('终端列数'),
        rows: z.number().int().min(10).max(120).optional().default(30).describe('终端行数'),
        decorate: z
          .enum(['terminal', 'none'])
          .optional()
          .default('terminal')
          .describe('terminal=叠加终端窗口装饰（红绿灯 + 空白标题栏 + 内容留白，默认）；none=原始画面'),
        sessionId: z.string().optional().describe('不填则新建会话'),
      },
    },
    handle(async ({ command, args, cwd, cols, rows, decorate, sessionId }) => {
      if (sessionId) {
        const existing = store.get('cli', sessionId) as CliSession;
        return errorResult(
          `会话 ${existing.id} 已在运行（terminal_open 不复用会话）。如需停止请调用 terminal_stop。`,
        );
      }

      const decoration = decorate === 'terminal' ? { kind: 'terminal' as const } : null;

      // terminal_open 默认开始录制，先确认 ffmpeg 可用，避免 pty 已启动后才失败
      if (decoration && !(await locateFfmpeg())) {
        return errorResult(
          '未找到 ffmpeg，无法录制视频。请安装 ffmpeg（brew install ffmpeg）或通过 MANTA_SHOW_FFMPEG 指定路径。',
        );
      }

      const view = await TerminalView.open(cols, rows);
      let session: CliSession;
      let recorder: Recorder | null = null;
      try {
        // 先开录制再起 pty：若先 spawn，输出可能在录制启动前就画完且不再重绘，视频会缺内容
        recorder = await Recorder.start(view.page, decoration);
        const pty = ptySpawn(command, args ?? [], {
          name: 'xterm-256color',
          cols,
          rows,
          cwd: cwd ?? process.cwd(),
          env: {
            ...process.env,
            TERM: 'xterm-256color',
            COLORTERM: 'truecolor',
            FORCE_COLOR: '1',
          } as Record<string, string>,
        });
        session = new CliSession(store.nextId('cli'), new PtySession(pty));
        session.view = view;
        session.pty.view = view; // pty 输出转发到回放页
        session.recorder = recorder;
        store.add(session);
      } catch (e) {
        await recorder?.dispose();
        await view.close();
        throw new Error(`启动命令失败：${e instanceof Error ? e.message : String(e)}`);
      }
      return textResult(
        `已在 pty 中启动 ${command} 并开始录制。sessionId=${session.id}\n` +
          '可用：terminal_read（看输出）、terminal_send / terminal_send_key（交互）、terminal_record_stop（导出 mp4）、terminal_stop（结束进程）。',
      );
    }),
  );

  server.registerTool(
    'terminal_read',
    {
      title: '读取终端输出',
      description: '返回终端最近 N 行渲染后的纯文本（已去除 ANSI 颜色码），供 Agent 判断当前状态。',
      inputSchema: {
        lines: z.number().int().min(1).max(500).optional().default(50).describe('返回最近多少行'),
        sessionId: z.string().optional().describe('cli 会话 id，缺省用最近的'),
      },
    },
    handle(async ({ lines, sessionId }) => {
      const session = store.get('cli', sessionId) as CliSession;
      return textResult(session.pty.recentText(lines));
    }),
  );

  server.registerTool(
    'terminal_send',
    {
      title: '向终端输入文本',
      description: '向正在运行的命令写入文本（不换行）；submit 为 true 时附加回车。',
      inputSchema: {
        text: z.string().describe('要写入的文本'),
        submit: z.boolean().optional().default(false).describe('是否附加回车'),
        sessionId: z.string().optional().describe('cli 会话 id，缺省用最近的'),
      },
    },
    handle(async ({ text, submit, sessionId }) => {
      const session = store.get('cli', sessionId) as CliSession;
      session.pty.write(text + (submit ? '\r' : ''));
      return textResult(`已写入${submit ? '并回车' : ''}。`);
    }),
  );

  server.registerTool(
    'terminal_send_key',
    {
      title: '向终端发送按键',
      description:
        '发送具名按键：enter、tab、esc、backspace、up/down/left/right、home/end、pageup/pagedown、ctrl+c、ctrl+d、ctrl+l、ctrl+u、ctrl+w、ctrl+z 等。',
      inputSchema: {
        key: z.string().describe('按键名，如 enter、ctrl+c'),
        sessionId: z.string().optional().describe('cli 会话 id，缺省用最近的'),
      },
    },
    handle(async ({ key, sessionId }) => {
      const session = store.get('cli', sessionId) as CliSession;
      const mapped = mapKey(key);
      if (mapped === null) return errorResult(`未知按键 "${key}"。可用：enter/esc/tab/ctrl+c/上下左右等。`);
      session.pty.write(mapped);
      return textResult(`已发送 ${key}。`);
    }),
  );

  server.registerTool(
    'terminal_record_stop',
    {
      title: '导出终端录制',
      description: '停止终端画面录制并合成 mp4，返回文件路径与 markdown 引用片段。',
      inputSchema: {
        path: z.string().optional().describe('输出 mp4 路径，缺省自动命名到 MANTA_SHOW_OUTPUT'),
        sessionId: z.string().optional().describe('cli 会话 id，缺省用最近的'),
      },
    },
    handle(async ({ path, sessionId }) => {
      const session = store.get('cli', sessionId) as CliSession;
      const recorder = session.recorder;
      if (!recorder) return errorResult('该会话没有进行中的录制。');
      session.recorder = null;
      const result = await recorder.stop(path ?? mediaPath('terminal', 'mp4'));
      return videoFileResult(result.outputPath, result.durationSec, result.frameCount);
    }),
  );

  server.registerTool(
    'terminal_stop',
    {
      title: '结束终端进程',
      description: '向终端进程发送 Ctrl+C，等待退出（超时强杀），返回退出码。会话保留，可 terminal_close 释放。',
      inputSchema: {
        sessionId: z.string().optional().describe('cli 会话 id，缺省用最近的'),
      },
    },
    handle(async ({ sessionId }) => {
      const session = store.get('cli', sessionId) as CliSession;
      const code = await session.pty.stop();
      return textResult(`终端进程已结束，退出码：${code}。`);
    }),
  );

  server.registerTool(
    'terminal_close',
    {
      title: '关闭终端会话',
      description: '结束终端进程、关闭回放页并释放资源。',
      inputSchema: {
        sessionId: z.string().optional().describe('cli 会话 id，缺省用最近的'),
      },
    },
    handle(async ({ sessionId }) => {
      const session = store.get('cli', sessionId) as CliSession;
      await store.remove(session);
      return textResult(`已关闭会话 ${session.id}。`);
    }),
  );
}
