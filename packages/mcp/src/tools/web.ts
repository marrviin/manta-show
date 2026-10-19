import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { t } from '../i18n/index.js';
import { SessionStore } from '../session.js';
import { getBrowser } from '../targets/browser.js';
import { WebSession } from '../targets/web.js';
import {
  errorResult,
  handle,
  registerCloseTool,
  registerPageTools,
  registerRecordPair,
  selectorField,
  sessionIdField,
  textResult,
} from './shared.js';

export function registerWebTools(server: McpServer, store: SessionStore): void {
  registerPageTools(server, store, {
    kind: 'web',
    prefix: 'browser',
    filePrefix: 'web',
    label: t('label.page'),
    selectorHint: t('web.selectorHint'),
    withFullPage: true,
    snapshotFallback: async (page) => (await page.content()).slice(0, 20_000),
    emptySnapshotMessage: t('web.emptySnapshot'),
    screenshotTitle: t('web.screenshot.title'),
    screenshotDescription: t('web.screenshot.desc'),
  });

  registerRecordPair(server, store, {
    kind: 'web',
    prefix: 'browser',
    filePrefix: 'web',
    decoration: 'browser',
    startTitle: t('web.record.start.title'),
    startDescription: t('web.record.start.desc'),
    startedDecoMessage: t('web.record.startedDeco'),
    startedRawMessage: t('web.record.startedRaw'),
    stopTitle: t('web.record.stop.title'),
    stopDescription: t('web.record.stop.desc'),
  });

  registerCloseTool(server, store, {
    name: 'browser_close',
    title: t('web.close.title'),
    description: t('web.close.desc'),
    kind: 'web',
  });

  server.registerTool(
    'browser_open',
    {
      title: t('web.open.title'),
      description: t('web.open.desc'),
      inputSchema: {
        url: z.string().url().describe(t('field.url')),
        width: z.number().int().min(200).max(4096).optional().default(1440).describe(t('field.viewportWidth')),
        height: z.number().int().min(200).max(4096).optional().default(810).describe(t('field.viewportHeight')),
        deviceScaleFactor: z.number().min(1).max(3).optional().default(2).describe(t('field.deviceScaleFactor')),
      },
    },
    handle(async ({ url, width, height, deviceScaleFactor }) => {
      const context = await (await getBrowser()).newContext({
        viewport: { width, height },
        deviceScaleFactor,
      });
      const page = await context.newPage();
      let loadNote = '';
      try {
        await page.goto(url, { waitUntil: 'load', timeout: 30_000 });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/timeout/i.test(msg)) {
          // Slow third-party scripts can keep 'load' from ever firing; the page itself is usually
          // already usable — degrade to what has rendered instead of failing the whole open.
          try {
            await page.waitForLoadState('domcontentloaded', { timeout: 5_000 });
            loadNote = t('web.open.loadNote');
          } catch {
            await context.close().catch(() => {});
            throw new Error(t('web.open.loadFail', { message: msg }));
          }
        } else {
          await context.close().catch(() => {});
          throw new Error(t('web.open.loadFail', { message: msg }));
        }
      }
      const session = new WebSession(store.nextId('web'), context, page);
      store.add(session);
      return textResult(
        t('web.open.result', { url, title: await page.title(), id: session.id, note: loadNote }),
      );
    }),
  );

  server.registerTool(
    'browser_navigate',
    {
      title: t('web.navigate.title'),
      description: t('web.navigate.desc'),
      inputSchema: {
        url: z.string().url().describe(t('field.url')),
        sessionId: sessionIdField('web'),
      },
    },
    handle(async ({ url, sessionId }) => {
      const session = store.get<WebSession>('web', sessionId);
      await session.page.goto(url, { waitUntil: 'load', timeout: 30_000 });
      // While recording, the renderer may briefly stall during navigation due to the screenshot self-healing; best-effort title, never blocking the return
      const title = await Promise.race([
        session.page.title(),
        new Promise<string>((r) => {
          const t0 = setTimeout(() => r(''), 3_000);
          t0.unref?.();
        }),
      ]);
      return textResult(
        title ? t('web.navigate.resultWithTitle', { url, title }) : t('web.navigate.result', { url }),
      );
    }),
  );

  server.registerTool(
    'browser_scroll',
    {
      title: t('web.scroll.title'),
      description: t('web.scroll.desc'),
      inputSchema: {
        selector: selectorField(t('purpose.scroll')),
        dy: z.number().int().optional().describe(t('field.dy')),
        sessionId: sessionIdField('web'),
      },
    },
    handle(async ({ selector, dy, sessionId }) => {
      const session = store.get<WebSession>('web', sessionId);
      if (selector) {
        try {
          await session.page.locator(selector).scrollIntoViewIfNeeded({ timeout: 5000 });
        } catch (e) {
          return errorResult(t('err.actionFailed', { message: e instanceof Error ? e.message : String(e) }));
        }
        return textResult(t('web.scroll.to', { selector }));
      }
      await session.page.mouse.wheel(0, dy ?? 600);
      return textResult(t('web.scroll.px', { px: dy ?? 600 }));
    }),
  );

  server.registerTool(
    'browser_evaluate',
    {
      title: t('web.evaluate.title'),
      description: t('web.evaluate.desc'),
      inputSchema: {
        script: z.string().describe(t('field.script')),
        sessionId: sessionIdField('web'),
      },
    },
    handle(async ({ script, sessionId }) => {
      const session = store.get<WebSession>('web', sessionId);
      let result: unknown;
      try {
        result = await session.page.evaluate(script);
      } catch (e) {
        return errorResult(t('err.evalFail', { message: e instanceof Error ? e.message : String(e) }));
      }
      const text =
        typeof result === 'string' ? result : JSON.stringify(result, null, 2) ?? String(result);
      return textResult(text || t('web.evaluate.noReturn'));
    }),
  );
}
