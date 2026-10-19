import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { t } from '../i18n/index.js';
import { SessionStore } from '../session.js';
import {
  ElectronSession,
  resolveInstalledAppBundle,
} from '../targets/electron.js';
import {
  errorResult,
  handle,
  registerCloseTool,
  registerPageTools,
  registerRecordPair,
  textResult,
} from './shared.js';

export function registerElectronTools(server: McpServer, store: SessionStore): void {
  registerPageTools(server, store, {
    kind: 'electron',
    prefix: 'electron',
    filePrefix: 'electron',
    label: t('label.window'),
    selectorHint: t('electron.selectorHint'),
    withFullPage: false,
    snapshotFallback: async () => '',
    emptySnapshotMessage: t('electron.emptySnapshot'),
    screenshotTitle: t('electron.screenshot.title'),
    screenshotDescription: t('electron.screenshot.desc'),
  });

  registerRecordPair(server, store, {
    kind: 'electron',
    prefix: 'electron',
    filePrefix: 'electron',
    decoration: 'desktop',
    startTitle: t('electron.record.start.title'),
    startDescription: t('electron.record.start.desc'),
    startedDecoMessage: t('electron.record.startedDeco'),
    startedRawMessage: t('electron.record.startedRaw'),
    stopTitle: t('electron.record.stop.title'),
    stopDescription: t('electron.record.stop.desc'),
  });

  registerCloseTool(server, store, {
    name: 'electron_close',
    title: t('electron.close.title'),
    description: t('electron.close.desc'),
    kind: 'electron',
  });

  server.registerTool(
    'electron_launch',
    {
      title: t('electron.launch.title'),
      description: t('electron.launch.desc'),
      inputSchema: {
        app: z.string().describe(t('field.app')),
        args: z.array(z.string()).optional().describe(t('field.extraArgs')),
        cwd: z.string().optional().describe(t('field.cwdSimple')),
      },
    },
    handle(async ({ app, args, cwd }) => {
      const { _electron } = await import('playwright');
      const executablePath = resolveInstalledAppBundle(app);
      let electronApp;
      try {
        electronApp = await _electron.launch({
          ...(executablePath
            ? { executablePath, args: args ?? [] }
            : { args: [app, ...(args ?? [])] }),
          cwd,
          // Hosts like VS Code inject ELECTRON_RUN_AS_NODE, which makes Electron start in pure Node mode and fail
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
          t('electron.launch.fail', { message: e instanceof Error ? e.message : String(e) }),
        );
      }
      const window = await electronApp.firstWindow();
      const session = new ElectronSession(store.nextId('electron'), electronApp, window);
      store.add(session);
      return textResult(
        t('electron.launch.result', { title: await window.title(), id: session.id }),
      );
    }),
  );
}
