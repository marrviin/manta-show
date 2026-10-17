import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ElectronApplication, Page } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { SessionStore, type SessionBase, type SessionKind } from '../session.js';
import { Recorder } from '../capture/recorder.js';
import { mediaPath } from '../util/media.js';
import {
  errorResult,
  handle,
  imageFileResult,
  textResult,
  videoFileResult,
  type ToolResult,
} from '../util/respond.js';

export class ElectronSession implements SessionBase {
  kind = 'electron' as const satisfies SessionKind;
  lastUsed = Date.now();
  recorder: Recorder | null = null;

  constructor(
    public id: string,
    public app: ElectronApplication,
    public window: Page,
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
    await this.app.close().catch(() => {});
  }
}

function selectorError(e: unknown, selector: string): ToolResult {
  const msg = e instanceof Error ? e.message : String(e);
  if (/timeout.*exceeded/i.test(msg)) {
    return errorResult(
      `选择器 5 秒内未命中：${selector}。建议先调用 electron_snapshot 查看界面可访问性树。`,
    );
  }
  return errorResult(`操作失败：${msg}`);
}

/**
 * 已安装的 macOS .app（打包产物）→ 取其内部 Electron 可执行文件走 executablePath；
 * 源码目录/入口 js → 保持原样交给本地 electron 运行。
 */
function resolveInstalledAppBundle(app: string): string | undefined {
  const bundle = app.endsWith('.app') ? app : undefined;
  if (!bundle) return undefined;
  const name = path.basename(bundle, '.app');
  const bin = path.join(bundle, 'Contents', 'MacOS', name);
  if (fs.existsSync(bin)) return bin;
  throw new Error(`在 ${bundle} 中找不到可执行文件 Contents/MacOS/${name}，请确认是有效的 macOS 应用包。`);
}

export function registerElectronTools(server: McpServer, store: SessionStore): void {
  server.registerTool(
    'electron_launch',
    {
      title: '启动 Electron 应用',
      description:
        '用 Playwright 的 _electron API 启动一个 Electron 应用并捕获其主窗口，返回 electron 会话 id。' +
        'app 支持三种形式：应用目录（含 package.json，用本地 electron 运行）、入口 js 文件路径、' +
        '或已安装的 macOS .app 包（如 /Applications/SomeApp.app，直接自动化打包产物）。',
      inputSchema: {
        app: z.string().describe('应用目录、入口 js 路径或已安装的 .app 包路径'),
        args: z.array(z.string()).optional().describe('传给应用的额外参数'),
        cwd: z.string().optional().describe('工作目录'),
      },
    },
    handle(async ({ app, args, cwd }) => {
      const { _electron } = await import('playwright');
      const executablePath = resolveInstalledAppBundle(app);
      let electronApp: ElectronApplication;
      try {
        electronApp = await _electron.launch({
          ...(executablePath
            ? { executablePath, args: args ?? [] }
            : { args: [app, ...(args ?? [])] }),
          cwd,
          // VS Code 等宿主会注入 ELECTRON_RUN_AS_NODE，导致 Electron 以纯 Node 模式启动失败
          env: (() => {
            const env: Record<string, string> = {};
            for (const [k, v] of Object.entries(process.env)) {
              if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE') env[k] = v;
            }
            return env;
          })(),
        });
      } catch (e) {
        return errorResult(
          `启动 Electron 应用失败：${e instanceof Error ? e.message : String(e)}。` +
            '源码应用需已安装 electron 依赖；打包 app 若拒绝调试参数（签名加固/单实例锁）则无法自动化。',
        );
      }
      const window = await electronApp.firstWindow();
      const session = new ElectronSession(store.nextId('electron'), electronApp, window);
      store.add(session);
      return textResult(
        `已启动并捕获主窗口（标题：${await window.title()}）。sessionId=${session.id}\n` +
          '可用：electron_snapshot / electron_click / electron_type / electron_screenshot / electron_record_start。',
      );
    }),
  );

  server.registerTool(
    'electron_snapshot',
    {
      title: '界面快照',
      description: '返回 Electron 窗口的可访问性树 YAML 快照，用于确定选择器。',
      inputSchema: {
        sessionId: z.string().optional().describe('electron 会话 id，缺省用最近的'),
      },
    },
    handle(async ({ sessionId }) => {
      const session = store.get('electron', sessionId) as ElectronSession;
      let snapshot: string;
      try {
        snapshot = await session.window.locator('body').ariaSnapshot();
      } catch {
        snapshot = '';
      }
      return textResult(snapshot || '(窗口无可访问性内容)');
    }),
  );

  server.registerTool(
    'electron_click',
    {
      title: '点击界面元素',
      description: '点击 Electron 窗口中匹配 CSS 选择器的元素。',
      inputSchema: {
        selector: z.string().describe('CSS 选择器'),
        sessionId: z.string().optional().describe('electron 会话 id，缺省用最近的'),
      },
    },
    handle(async ({ selector, sessionId }) => {
      const session = store.get('electron', sessionId) as ElectronSession;
      try {
        await session.window.locator(selector).click({ timeout: 5000 });
      } catch (e) {
        return selectorError(e, selector);
      }
      return textResult(`已点击 ${selector}。`);
    }),
  );

  server.registerTool(
    'electron_type',
    {
      title: '输入文本',
      description: '向 Electron 窗口中的输入框清空并输入文本；submit 为 true 时附加回车。',
      inputSchema: {
        selector: z.string().describe('输入框 CSS 选择器'),
        text: z.string().describe('要输入的文本'),
        submit: z.boolean().optional().default(false).describe('输入后是否按回车'),
        sessionId: z.string().optional().describe('electron 会话 id，缺省用最近的'),
      },
    },
    handle(async ({ selector, text, submit, sessionId }) => {
      const session = store.get('electron', sessionId) as ElectronSession;
      try {
        const loc = session.window.locator(selector);
        await loc.fill('', { timeout: 5000 });
        await loc.pressSequentially(text, { timeout: 10_000 });
        if (submit) await loc.press('Enter', { timeout: 5000 });
      } catch (e) {
        return selectorError(e, selector);
      }
      return textResult(`已在 ${selector} 输入文本${submit ? '并回车' : ''}。`);
    }),
  );

  server.registerTool(
    'electron_press_key',
    {
      title: '按键',
      description: '向 Electron 窗口发送键盘按键（Playwright 键名，如 Enter / Escape）。',
      inputSchema: {
        key: z.string().describe('按键名'),
        sessionId: z.string().optional().describe('electron 会话 id，缺省用最近的'),
      },
    },
    handle(async ({ key, sessionId }) => {
      const session = store.get('electron', sessionId) as ElectronSession;
      await session.window.keyboard.press(key);
      return textResult(`已按键 ${key}。`);
    }),
  );

  server.registerTool(
    'electron_screenshot',
    {
      title: '应用截图',
      description: '截取 Electron 窗口或指定元素，返回图片本体和保存路径。',
      inputSchema: {
        selector: z.string().optional().describe('元素级截图的 CSS 选择器'),
        path: z.string().optional().describe('输出文件路径，缺省自动命名'),
        sessionId: z.string().optional().describe('electron 会话 id，缺省用最近的'),
      },
    },
    handle(async ({ selector, path, sessionId }) => {
      const session = store.get('electron', sessionId) as ElectronSession;
      const file = path ?? mediaPath('electron-screenshot', 'png');
      try {
        if (selector) {
          await session.window.locator(selector).screenshot({ path: file, timeout: 10_000 });
        } else {
          await session.window.screenshot({ path: file });
        }
      } catch (e) {
        return selectorError(e, selector ?? 'window');
      }
      return imageFileResult(file);
    }),
  );

  server.registerTool(
    'electron_record_start',
    {
      title: '开始录制应用画面',
      description:
        '开始录制 Electron 主窗口画面。录制期间继续交互，动作会被录进去。' +
        "默认给视频叠加 macOS 桌面装饰（应用窗口带圆角投影，放在桌面壁纸上），像在电脑上使用的实拍效果。",
      inputSchema: {
        decorate: z
          .enum(['desktop', 'none'])
          .optional()
          .default('desktop')
          .describe('desktop=叠加桌面壁纸装饰（默认）；none=原始画面'),
        sessionId: z.string().optional().describe('electron 会话 id，缺省用最近的'),
      },
    },
    handle(async ({ decorate, sessionId }) => {
      const session = store.get('electron', sessionId) as ElectronSession;
      if (session.recorder) return errorResult('该会话已在录制中，请先调用 electron_record_stop。');
      const decoration = decorate === 'desktop' ? { kind: 'desktop' as const } : null;
      session.recorder = await Recorder.start(session.window, decoration);
      return textResult(
        decoration
          ? '录制已开始（含 macOS 桌面装饰）。完成交互后调用 electron_record_stop 导出 mp4。'
          : '录制已开始（原始画面）。完成交互后调用 electron_record_stop 导出 mp4。',
      );
    }),
  );

  server.registerTool(
    'electron_record_stop',
    {
      title: '结束录制应用画面',
      description: '停止录制并合成 mp4（默认统一输出 1920×1080），返回文件路径与 markdown 引用片段。',
      inputSchema: {
        path: z.string().optional().describe('输出 mp4 路径，缺省自动命名'),
        fit: z
          .enum(['canvas', 'native'])
          .optional()
          .default('canvas')
          .describe('canvas=统一输出 1920×1080（默认）；native=保持录制原始尺寸'),
        sessionId: z.string().optional().describe('electron 会话 id，缺省用最近的'),
      },
    },
    handle(async ({ path, fit, sessionId }) => {
      const session = store.get('electron', sessionId) as ElectronSession;
      const recorder = session.recorder;
      if (!recorder) return errorResult('该会话没有进行中的录制，请先调用 electron_record_start。');
      session.recorder = null;
      const result = await recorder.stop(path ?? mediaPath('electron-video', 'mp4'), { fit });
      return videoFileResult(result.outputPath, result.durationSec, result.frameCount);
    }),
  );

  server.registerTool(
    'electron_close',
    {
      title: '关闭应用',
      description: '关闭 Electron 应用并释放资源。',
      inputSchema: {
        sessionId: z.string().optional().describe('electron 会话 id，缺省用最近的'),
      },
    },
    handle(async ({ sessionId }) => {
      const session = store.get('electron', sessionId) as ElectronSession;
      await store.remove(session);
      return textResult(`已关闭会话 ${session.id}。`);
    }),
  );
}
