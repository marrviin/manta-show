import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Page } from 'playwright';
import { t } from '../i18n/index.js';
import { BaseCaptureSession, type SessionKind, type SessionStore } from '../session.js';
import { Recorder, type RecordFit } from '../pipeline/recorder.js';
import type { RecordDecoration } from '../pipeline/decoration.js';
import { mediaPath } from '../util/media.js';
import {
  errorResult,
  handle,
  imageFileResult,
  textResult,
  videoFileResult,
  type ToolResult,
} from '../util/respond.js';

// Re-exported so tool modules can pull the whole tool-writing toolkit from one place
export { errorResult, handle, imageFileResult, textResult, videoFileResult, type ToolResult } from '../util/respond.js';

/** Session types whose capture target is a Playwright Page (web + electron); cli is pty-based */
export type PageSession = BaseCaptureSession & { page: Page };

/** Shared zod fields: used by the tool schemas of all three capture lines, keeping copy consistent */
export const sessionIdField = (kind: SessionKind) =>
  z.string().optional().describe(t('field.sessionId', { kind }));

export const outPathField = () =>
  z.string().optional().describe(t('field.outPath'));

export const fitField = () =>
  z
    .enum(['canvas', 'native'])
    .optional()
    .default('canvas')
    .describe(t('field.fit'));

/**
 * Selector field. page.locator() accepts Playwright's full selector engine (css / text= / role=
 * / xpath= / id=), which is far easier for agents to hit than hand-written CSS from the a11y tree
 * — advertise it explicitly instead of saying "CSS selectors".
 */
export const selectorField = (purpose: string) =>
  z
    .string()
    .describe(t('field.selector', { purpose }));

export function selectorError(e: unknown, selector: string, snapshotHint: string): ToolResult {
  const msg = e instanceof Error ? e.message : String(e);
  if (/timeout.*exceeded/i.test(msg)) {
    return errorResult(t('err.selectorTimeout', { selector, hint: snapshotHint }));
  }
  return errorResult(t('err.actionFailed', { message: msg }));
}

/**
 * One choreographed action in batch recording. Steps run in order while the recorder is up, so a
 * whole demo plays out in one call — per-action MCP round-trips make the video feel slow and
 * mechanical; batch mode is both faster on video and cheaper in agent turns.
 */
const recordStepSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('click'), selector: z.string() }),
  z.object({ type: z.literal('hover'), selector: z.string() }),
  z.object({
    type: z.literal('type'),
    selector: z.string(),
    text: z.string(),
    submit: z.boolean().optional().default(false),
  }),
  z.object({ type: z.literal('press'), key: z.string() }),
  z.object({
    type: z.literal('scroll'),
    dy: z.number().int().optional().describe(t('field.scrollDyBatch')),
    selector: z.string().optional().describe(t('field.scrollSelectorBatch')),
  }),
  z.object({ type: z.literal('evaluate'), script: z.string() }),
  z.object({ type: z.literal('wait'), ms: z.number().int().min(50).max(10_000) }),
]);
export type RecordStep = z.infer<typeof recordStepSchema>;

export const stepsField = () =>
  z
    .array(recordStepSchema)
    .optional()
    .describe(t('field.steps'));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Execute choreographed steps on a page while the recorder runs. Per-step failure aborts the
 * sequence but the caller keeps recording until it decides to stop (a partially completed demo
 * is still a usable artifact).
 */
export async function runSteps(
  page: Page,
  steps: RecordStep[],
  gapMs: number,
): Promise<{ ok: true } | { ok: false; index: number; message: string }> {
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (i > 0 && gapMs > 0) await sleep(gapMs);
    try {
      switch (s.type) {
        case 'click':
          await page.locator(s.selector).click({ timeout: 5000 });
          break;
        case 'hover':
          await page.locator(s.selector).hover({ timeout: 5000 });
          break;
        case 'type': {
          const loc = page.locator(s.selector);
          await loc.fill('', { timeout: 5000 });
          await loc.pressSequentially(s.text, { timeout: 10_000 });
          if (s.submit) await loc.press('Enter', { timeout: 5000 });
          break;
        }
        case 'press':
          await page.keyboard.press(s.key);
          break;
        case 'scroll':
          if (s.selector) await page.locator(s.selector).scrollIntoViewIfNeeded({ timeout: 5000 });
          else await page.mouse.wheel(0, s.dy ?? 600);
          break;
        case 'evaluate':
          await page.evaluate(s.script);
          break;
        case 'wait':
          await sleep(s.ms);
          break;
      }
    } catch (e) {
      return { ok: false, index: i, message: e instanceof Error ? e.message : String(e) };
    }
  }
  return { ok: true };
}

/** Stop the session's recorder and return the mp4 result body (shared by manual stop and batch auto-stop) */
async function stopToResult(
  session: BaseCaptureSession,
  filePrefix: string,
  fit: RecordFit,
  path?: string,
): Promise<ToolResult> {
  const recorder = session.recorder;
  if (!recorder) return errorResult(t('err.noRecording'));
  session.recorder = null;
  const result = await recorder.stop(path ?? mediaPath(`${filePrefix}-video`, 'mp4'), { fit });
  return videoFileResult(result.outputPath, result.durationSec, result.frameCount);
}

/**
 * Shared web / electron interaction tools: snapshot / click / type / press_key / screenshot.
 * Both lines target a Playwright Page and behave identically; differences (copy, fullPage,
 * snapshot fallback) come in through opts.
 */
export function registerPageTools(
  server: McpServer,
  store: SessionStore,
  opts: {
    kind: 'web' | 'electron';
    /** Tool-name prefix: browser_ / electron_ */
    prefix: string;
    /** Output file prefix, e.g. 'web' → web-screenshot-*.png (may differ from prefix) */
    filePrefix: string;
    /** Object name used in description copy: page (页面) / window (窗口) — localized via i18n */
    label: string;
    /** Guidance hint shown when a selector misses */
    selectorHint: string;
    withFullPage: boolean;
    /** Fallback content when ariaSnapshot fails */
    snapshotFallback(page: Page): Promise<string>;
    emptySnapshotMessage: string;
    screenshotTitle: string;
    screenshotDescription: string;
  },
): void {
  const { kind, prefix, label } = opts;

  server.registerTool(
    `${prefix}_snapshot`,
    {
      title: t('page.snapshot.title', { label }),
      description: t('page.snapshot.desc', { label }),
      inputSchema: { sessionId: sessionIdField(kind) },
    },
    handle(async ({ sessionId }) => {
      const session = store.get<PageSession>(kind, sessionId);
      let snapshot: string;
      try {
        snapshot = await session.page.locator('body').ariaSnapshot();
      } catch {
        snapshot = await opts.snapshotFallback(session.page);
      }
      return textResult(snapshot || opts.emptySnapshotMessage);
    }),
  );

  server.registerTool(
    `${prefix}_click`,
    {
      title: t('page.click.title', { label }),
      description: t('page.click.desc', { label }),
      inputSchema: {
        selector: selectorField(t('purpose.click')),
        sessionId: sessionIdField(kind),
      },
    },
    handle(async ({ selector, sessionId }) => {
      const session = store.get<PageSession>(kind, sessionId);
      try {
        await session.page.locator(selector).click({ timeout: 5000 });
      } catch (e) {
        return selectorError(e, selector, opts.selectorHint);
      }
      return textResult(t('result.clicked', { selector }));
    }),
  );

  server.registerTool(
    `${prefix}_type`,
    {
      title: t('page.type.title'),
      description: t('page.type.desc', { label }),
      inputSchema: {
        selector: selectorField(t('purpose.input')),
        text: z.string().describe(t('field.text')),
        submit: z.boolean().optional().default(false).describe(t('field.submit')),
        sessionId: sessionIdField(kind),
      },
    },
    handle(async ({ selector, text, submit, sessionId }) => {
      const session = store.get<PageSession>(kind, sessionId);
      try {
        const loc = session.page.locator(selector);
        await loc.fill('', { timeout: 5000 });
        await loc.pressSequentially(text, { timeout: 10_000 });
        if (submit) await loc.press('Enter', { timeout: 5000 });
      } catch (e) {
        return selectorError(e, selector, opts.selectorHint);
      }
      return textResult(t('result.typed', { selector, enter: submit ? t('common.andEnter') : '' }));
    }),
  );

  server.registerTool(
    `${prefix}_press_key`,
    {
      title: t('page.pressKey.title'),
      description: t('page.pressKey.desc', { label }),
      inputSchema: {
        key: z.string().describe(t('field.key')),
        sessionId: sessionIdField(kind),
      },
    },
    handle(async ({ key, sessionId }) => {
      const session = store.get<PageSession>(kind, sessionId);
      await session.page.keyboard.press(key);
      return textResult(t('result.pressed', { key }));
    }),
  );

  server.registerTool(
    `${prefix}_hover`,
    {
      title: t('page.hover.title'),
      description: t('page.hover.desc'),
      inputSchema: {
        selector: selectorField(t('purpose.hover')),
        sessionId: sessionIdField(kind),
      },
    },
    handle(async ({ selector, sessionId }) => {
      const session = store.get<PageSession>(kind, sessionId);
      try {
        await session.page.locator(selector).hover({ timeout: 5000 });
      } catch (e) {
        return selectorError(e, selector, opts.selectorHint);
      }
      return textResult(t('result.hovered', { selector }));
    }),
  );

  server.registerTool(
    `${prefix}_screenshot`,
    {
      title: opts.screenshotTitle,
      description: opts.screenshotDescription,
      inputSchema: {
        selector: selectorField(t('purpose.screenshot')).optional(),
        ...(opts.withFullPage
          ? {
              fullPage: z.boolean().optional().default(false).describe(t('field.fullPage')),
            }
          : {}),
        path: outPathField(),
        sessionId: sessionIdField(kind),
      },
    },
    handle(async ({ selector, fullPage, path, sessionId }) => {
      const session = store.get<PageSession>(kind, sessionId);
      const file = path ?? mediaPath(`${opts.filePrefix}-screenshot`, 'png');
      try {
        if (selector) {
          await session.page.locator(selector).screenshot({ path: file, timeout: 10_000 });
        } else {
          await session.page.screenshot({ path: file, fullPage });
        }
      } catch (e) {
        if (selector) return selectorError(e, selector, opts.selectorHint);
        return errorResult(t('err.screenshotFail', { message: e instanceof Error ? e.message : String(e) }));
      }
      return imageFileResult(file);
    }),
  );
}

/**
 * Shared record_stop tool (one per capture line — web / electron / cli — differing only in name
 * and default file prefix): resolve session → verify recording → stop and assemble the mp4 →
 * return path + markdown reference.
 */
export function registerRecordStopTool(
  server: McpServer,
  store: SessionStore,
  opts: {
    name: string;
    title: string;
    description: string;
    kind: SessionKind;
    /** Output file prefix, e.g. 'web' → web-video-*.mp4 */
    filePrefix: string;
    missingMessage: string;
  },
): void {
  server.registerTool(
    opts.name,
    {
      title: opts.title,
      description: opts.description,
      inputSchema: {
        path: outPathField(),
        fit: fitField(),
        sessionId: sessionIdField(opts.kind),
      },
    },
    handle(async ({ path, fit, sessionId }) => {
      const session = store.get<BaseCaptureSession>(opts.kind, sessionId);
      if (!session.recorder) return errorResult(opts.missingMessage);
      return stopToResult(session, opts.filePrefix, fit as RecordFit, path);
    }),
  );
}

/**
 * Shared web / electron recording pair (record_start + record_stop).
 * The cli line starts recording with terminal_open and only registers record_stop — not here.
 */
export function registerRecordPair(
  server: McpServer,
  store: SessionStore,
  opts: {
    kind: 'web' | 'electron';
    prefix: string;
    /** Default decoration: browser=window chrome; desktop=macOS desktop wallpaper */
    decoration: Exclude<RecordDecoration, null>['kind'];
    startTitle: string;
    startDescription: string;
    startedDecoMessage: string;
    startedRawMessage: string;
    stopTitle: string;
    stopDescription: string;
    filePrefix: string;
  },
): void {
  server.registerTool(
    `${opts.prefix}_record_start`,
    {
      title: opts.startTitle,
      description: opts.startDescription,
      inputSchema: {
        decorate: z
          .enum([opts.decoration, 'none'] as const)
          .optional()
          .default(opts.decoration)
          .describe(t('field.decorate', { deco: opts.decoration })),
        cursor: z
          .boolean()
          .optional()
          .default(true)
          .describe(t('field.cursor')),
        steps: stepsField(),
        stepGapMs: z
          .number()
          .int()
          .min(0)
          .max(5000)
          .optional()
          .default(400)
          .describe(t('field.stepGapMs')),
        sessionId: sessionIdField(opts.kind),
      },
    },
    handle(async ({ decorate, cursor, steps, stepGapMs, sessionId }) => {
      const session = store.get<PageSession>(opts.kind, sessionId);
      if (session.recorder) {
        return errorResult(t('err.alreadyRecording', { prefix: opts.prefix }));
      }
      const decoration: RecordDecoration | null =
        decorate === opts.decoration ? ({ kind: opts.decoration } as RecordDecoration) : null;
      session.recorder = await Recorder.start(session.page, decoration, { cursor });

      // Batch mode: play the whole sequence, then auto-stop and produce the video; a failed step
      // also stops and exports the completed portion
      if (steps && steps.length > 0) {
        const outcome = await runSteps(session.page, steps, stepGapMs ?? 400);
        let video: ToolResult;
        try {
          video = await stopToResult(session, opts.filePrefix, 'canvas');
        } catch (e) {
          return errorResult(t('err.batchStopFail', { message: e instanceof Error ? e.message : String(e) }));
        }
        if (!outcome.ok) {
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: t('err.batchStepFail', {
                  index: outcome.index + 1,
                  total: steps.length,
                  message: outcome.message,
                }),
              },
              ...video.content,
            ],
          };
        }
        return video;
      }

      return textResult(decoration ? opts.startedDecoMessage : opts.startedRawMessage);
    }),
  );

  registerRecordStopTool(server, store, {
    name: `${opts.prefix}_record_stop`,
    title: opts.stopTitle,
    description: opts.stopDescription,
    kind: opts.kind,
    filePrefix: opts.filePrefix,
    missingMessage: t('err.recordStopMissing', { prefix: opts.prefix }),
  });
}

/** Shared close-session tool for all three lines: remove from the store and release resources (an unstopped recording is flushed to disk by BaseCaptureSession.close) */
export function registerCloseTool(
  server: McpServer,
  store: SessionStore,
  opts: { name: string; title: string; description: string; kind: SessionKind },
): void {
  server.registerTool(
    opts.name,
    {
      title: opts.title,
      description: opts.description,
      inputSchema: { sessionId: sessionIdField(opts.kind) },
    },
    handle(async ({ sessionId }) => {
      const session = store.get(opts.kind, sessionId);
      await store.remove(session);
      return textResult(t('result.closed', { id: session.id }));
    }),
  );
}
