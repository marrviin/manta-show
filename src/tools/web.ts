import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { BrowserContext, Page } from 'playwright';
import { SessionStore, type SessionBase, type SessionKind } from '../session.js';
import { getBrowser } from '../capture/browser.js';
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

export class WebSession implements SessionBase {
  kind = 'web' as const satisfies SessionKind;
  lastUsed = Date.now();
  recorder: Recorder | null = null;

  constructor(
    public id: string,
    public context: BrowserContext,
    public page: Page,
  ) {}

  async close(): Promise<void> {
    if (this.recorder) {
      const out = mediaPath('video', 'mp4');
      try {
        await this.recorder.stop(out);
      } catch {
        // 会话关闭时丢弃未完成的录制
      }
      this.recorder = null;
    }
    await this.context.close().catch(() => {});
  }
}

function selectorError(e: unknown, selector: string): ToolResult {
  const msg = e instanceof Error ? e.message : String(e);
  if (/timeout.*exceeded/i.test(msg)) {
    return errorResult(
      `选择器 5 秒内未命中：${selector}。建议先调用 browser_snapshot 查看页面可访问性树，确认选择器后再试。`,
    );
  }
  return errorResult(`操作失败：${msg}`);
}

export function registerWebTools(server: McpServer, store: SessionStore): void {
  server.registerTool(
    'browser_open',
    {
      title: '打开网页',
      description:
        '在无头 Chromium 中打开一个网页，返回 web 会话 id。后续用 browser_* 工具与之交互（缺省操作最近打开的会话）。',
      inputSchema: {
        url: z.string().url().describe('要打开的 URL'),
        width: z.number().int().min(200).max(4096).optional().default(1440).describe('视口宽度'),
        height: z.number().int().min(200).max(4096).optional().default(810).describe('视口高度'),
        deviceScaleFactor: z.number().min(1).max(3).optional().default(2).describe('设备像素比，2 输出高清 2x 图'),
      },
    },
    handle(async ({ url, width, height, deviceScaleFactor }) => {
      const context = await (await getBrowser()).newContext({
        viewport: { width, height },
        deviceScaleFactor,
      });
      const page = await context.newPage();
      try {
        await page.goto(url, { waitUntil: 'load', timeout: 30_000 });
      } catch (e) {
        await context.close().catch(() => {});
        throw new Error(`页面加载失败：${e instanceof Error ? e.message : String(e)}`);
      }
      const session = new WebSession(store.nextId('web'), context, page);
      store.add(session);
      return textResult(
        `已打开 ${url}（标题：${await page.title()}）。sessionId=${session.id}\n` +
          '接下来可用：browser_snapshot / browser_click / browser_type / browser_screenshot / browser_record_start。',
      );
    }),
  );

  server.registerTool(
    'browser_navigate',
    {
      title: '页面跳转',
      description: '让当前 web 会话导航到新 URL。',
      inputSchema: {
        url: z.string().url().describe('目标 URL'),
        sessionId: z.string().optional().describe('web 会话 id，缺省用最近的'),
      },
    },
    handle(async ({ url, sessionId }) => {
      const session = store.get('web', sessionId) as WebSession;
      await session.page.goto(url, { waitUntil: 'load', timeout: 30_000 });
      // 录制中导航时渲染进程可能因截图自愈短暂无响应，标题尽力而为，不阻塞返回
      const title = await Promise.race([
        session.page.title(),
        new Promise<string>((r) => {
          const t = setTimeout(() => r(''), 3_000);
          t.unref?.();
        }),
      ]);
      return textResult(`已跳转到 ${url}${title ? `（标题：${title}）` : ''}。`);
    }),
  );

  server.registerTool(
    'browser_snapshot',
    {
      title: '页面快照',
      description:
        '返回页面可访问性树的 YAML 快照（元素角色、名称、ref），用于确定要点击/输入的选择器。',
      inputSchema: {
        sessionId: z.string().optional().describe('web 会话 id，缺省用最近的'),
      },
    },
    handle(async ({ sessionId }) => {
      const session = store.get('web', sessionId) as WebSession;
      let snapshot: string;
      try {
        snapshot = await session.page.locator('body').ariaSnapshot();
      } catch {
        const html = await session.page.content();
        snapshot = html.slice(0, 20_000);
      }
      return textResult(snapshot || '(页面为空)');
    }),
  );

  server.registerTool(
    'browser_click',
    {
      title: '点击元素',
      description: '点击匹配 CSS 选择器的第一个元素。',
      inputSchema: {
        selector: z.string().describe('CSS 选择器'),
        sessionId: z.string().optional().describe('web 会话 id，缺省用最近的'),
      },
    },
    handle(async ({ selector, sessionId }) => {
      const session = store.get('web', sessionId) as WebSession;
      try {
        await session.page.locator(selector).click({ timeout: 5000 });
      } catch (e) {
        return selectorError(e, selector);
      }
      return textResult(`已点击 ${selector}。`);
    }),
  );

  server.registerTool(
    'browser_type',
    {
      title: '输入文本',
      description: '先清空输入框再逐字输入文本；submit 为 true 时附加回车。',
      inputSchema: {
        selector: z.string().describe('输入框 CSS 选择器'),
        text: z.string().describe('要输入的文本'),
        submit: z.boolean().optional().default(false).describe('输入后是否按回车提交'),
        sessionId: z.string().optional().describe('web 会话 id，缺省用最近的'),
      },
    },
    handle(async ({ selector, text, submit, sessionId }) => {
      const session = store.get('web', sessionId) as WebSession;
      try {
        const loc = session.page.locator(selector);
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
    'browser_press_key',
    {
      title: '按键',
      description: '向页面发送一次键盘按键，如 Enter、Escape、ArrowDown、Control+A。',
      inputSchema: {
        key: z.string().describe('按键名（Playwright 键名，如 Enter / Tab / ArrowDown）'),
        sessionId: z.string().optional().describe('web 会话 id，缺省用最近的'),
      },
    },
    handle(async ({ key, sessionId }) => {
      const session = store.get('web', sessionId) as WebSession;
      await session.page.keyboard.press(key);
      return textResult(`已按键 ${key}。`);
    }),
  );

  server.registerTool(
    'browser_hover',
    {
      title: '悬停',
      description: '把鼠标悬停在匹配选择器的元素上（用于展示 hover 态、下拉菜单等）。',
      inputSchema: {
        selector: z.string().describe('CSS 选择器'),
        sessionId: z.string().optional().describe('web 会话 id，缺省用最近的'),
      },
    },
    handle(async ({ selector, sessionId }) => {
      const session = store.get('web', sessionId) as WebSession;
      try {
        await session.page.locator(selector).hover({ timeout: 5000 });
      } catch (e) {
        return selectorError(e, selector);
      }
      return textResult(`已悬停 ${selector}。`);
    }),
  );

  server.registerTool(
    'browser_scroll',
    {
      title: '滚动',
      description: '给出 selector 时滚动到该元素可见；否则按 dy 像素滚动页面。',
      inputSchema: {
        selector: z.string().optional().describe('滚动到该元素可见'),
        dy: z.number().int().optional().describe('垂直滚动像素，正数向下'),
        sessionId: z.string().optional().describe('web 会话 id，缺省用最近的'),
      },
    },
    handle(async ({ selector, dy, sessionId }) => {
      const session = store.get('web', sessionId) as WebSession;
      if (selector) {
        try {
          await session.page.locator(selector).scrollIntoViewIfNeeded({ timeout: 5000 });
        } catch (e) {
          return selectorError(e, selector);
        }
        return textResult(`已滚动到 ${selector}。`);
      }
      await session.page.mouse.wheel(0, dy ?? 600);
      return textResult(`已滚动 ${dy ?? 600}px。`);
    }),
  );

  server.registerTool(
    'browser_evaluate',
    {
      title: '执行页面 JS',
      description: '在页面上下文执行一段 JS 表达式并返回结果（JSON 序列化）。注意：会真实改动页面。',
      inputSchema: {
        script: z.string().describe('JS 表达式，如 document.title 或 1+1'),
        sessionId: z.string().optional().describe('web 会话 id，缺省用最近的'),
      },
    },
    handle(async ({ script, sessionId }) => {
      const session = store.get('web', sessionId) as WebSession;
      let result: unknown;
      try {
        result = await session.page.evaluate(script);
      } catch (e) {
        return errorResult(`执行失败：${e instanceof Error ? e.message : String(e)}`);
      }
      const text =
        typeof result === 'string' ? result : JSON.stringify(result, null, 2) ?? String(result);
      return textResult(text || '(无返回值)');
    }),
  );

  server.registerTool(
    'browser_screenshot',
    {
      title: '网页截图',
      description:
        '截图当前页面。给 selector 时只截取该元素（适合组件级产品图）；fullPage 截整页。返回图片本体和保存路径。',
      inputSchema: {
        selector: z.string().optional().describe('元素级截图的 CSS 选择器'),
        fullPage: z.boolean().optional().default(false).describe('是否截取整页（无 selector 时生效）'),
        path: z.string().optional().describe('输出文件路径，缺省自动命名到 MANTA_SHOW_OUTPUT'),
        sessionId: z.string().optional().describe('web 会话 id，缺省用最近的'),
      },
    },
    handle(async ({ selector, fullPage, path, sessionId }) => {
      const session = store.get('web', sessionId) as WebSession;
      const file = path ?? mediaPath('screenshot', 'png');
      try {
        if (selector) {
          await session.page.locator(selector).screenshot({ path: file, timeout: 10_000 });
        } else {
          await session.page.screenshot({ path: file, fullPage });
        }
      } catch (e) {
        return selectorError(e, selector ?? 'page');
      }
      return imageFileResult(file);
    }),
  );

  server.registerTool(
    'browser_record_start',
    {
      title: '开始录制',
      description:
        '开始录制当前 web 会话的画面。录制期间继续用 browser_* 工具交互，动作都会被录进去。' +
        '默认给视频叠加 macOS 浏览器窗框装饰（红绿灯 + 空白地址栏 + 圆角），像在真实浏览器中录制的效果。',
      inputSchema: {
        decorate: z
          .enum(['browser', 'none'])
          .optional()
          .default('browser')
          .describe('browser=叠加浏览器窗框（默认）；none=原始画面'),
        sessionId: z.string().optional().describe('web 会话 id，缺省用最近的'),
      },
    },
    handle(async ({ decorate, sessionId }) => {
      const session = store.get('web', sessionId) as WebSession;
      if (session.recorder) return errorResult('该会话已在录制中，请先调用 browser_record_stop。');
      const decoration = decorate === 'browser' ? { kind: 'browser' as const } : null;
      session.recorder = await Recorder.start(session.page, decoration);
      return textResult(
        decoration
          ? '录制已开始（含浏览器窗框装饰）。完成交互后调用 browser_record_stop 导出 mp4。'
          : '录制已开始（原始画面）。完成交互后调用 browser_record_stop 导出 mp4。',
      );
    }),
  );

  server.registerTool(
    'browser_record_stop',
    {
      title: '结束录制',
      description: '停止录制并合成 mp4（默认统一输出 1920×1080），返回文件路径、时长与 markdown 引用片段。',
      inputSchema: {
        path: z.string().optional().describe('输出 mp4 路径，缺省自动命名到 MANTA_SHOW_OUTPUT'),
        fit: z
          .enum(['canvas', 'native'])
          .optional()
          .default('canvas')
          .describe('canvas=统一输出 1920×1080（默认）；native=保持录制原始尺寸'),
        sessionId: z.string().optional().describe('web 会话 id，缺省用最近的'),
      },
    },
    handle(async ({ path, fit, sessionId }) => {
      const session = store.get('web', sessionId) as WebSession;
      const recorder = session.recorder;
      if (!recorder) return errorResult('该会话没有进行中的录制，请先调用 browser_record_start。');
      session.recorder = null;
      const result = await recorder.stop(path ?? mediaPath('video', 'mp4'), { fit });
      return videoFileResult(result.outputPath, result.durationSec, result.frameCount);
    }),
  );

  server.registerTool(
    'browser_close',
    {
      title: '关闭会话',
      description: '关闭 web 会话并释放浏览器资源（未 stop 的录制会被丢弃）。',
      inputSchema: {
        sessionId: z.string().optional().describe('web 会话 id，缺省用最近的'),
      },
    },
    handle(async ({ sessionId }) => {
      const session = store.get('web', sessionId) as WebSession;
      await store.remove(session);
      return textResult(`已关闭会话 ${session.id}。`);
    }),
  );
}
