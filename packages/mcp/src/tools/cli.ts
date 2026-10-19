import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { t } from '../i18n/index.js';
import { SessionStore } from '../session.js';
import { PtySession, TerminalView, mapKey } from '../targets/terminal.js';
import { CliSession } from '../targets/cli.js';
import { OUTPUT_WIDTH, OUTPUT_HEIGHT, Recorder } from '../pipeline/recorder.js';
import { planTerminalLayout, type RecordDecoration } from '../pipeline/decoration.js';
import { FFMPEG_MISSING_MESSAGE, locateFfmpeg } from '../deps/ffmpeg.js';
import { containerSpawn, checkContainerDaemon, detectContainerRuntime } from '../deps/container.js';
import { spawn as ptySpawn } from 'node-pty';
import { errorResult, handle, textResult } from '../util/respond.js';
import {
  registerCloseTool,
  registerRecordStopTool,
  sessionIdField,
} from './shared.js';

export function registerCliTools(server: McpServer, store: SessionStore): void {
  server.registerTool(
    'terminal_open',
    {
      title: t('cli.open.title'),
      description: t('cli.open.desc'),
      inputSchema: {
        command: z.string().describe(t('field.command')),
        args: z.array(z.string()).optional().describe(t('field.args')),
        cwd: z
          .string()
          .optional()
          .describe(t('field.cwd')),
        env: z
          .record(z.string(), z.string())
          .optional()
          .describe(t('field.env')),
        isolation: z
          .enum(['none', 'container'])
          .optional()
          .default('none')
          .describe(t('field.isolation')),
        image: z
          .string()
          .optional()
          .default('node:22')
          .describe(t('field.image')),
        volumes: z
          .array(z.string())
          .optional()
          .describe(t('field.volumes')),
        cols: z.number().int().min(40).max(400).optional().default(120).describe(t('field.cols')),
        rows: z.number().int().min(10).max(120).optional().default(30).describe(t('field.rows')),
        decorate: z
          .enum(['terminal', 'none'])
          .optional()
          .default('terminal')
          .describe(t('field.decorate', { deco: 'terminal' })),
      },
    },
    handle(async ({ command, args, cwd, env: extraEnv, isolation, image, volumes, cols, rows, decorate }) => {
      const inContainer = isolation === 'container';
      // Interactive shell (bash/zsh/sh/fish): the user is expected to type into it, so no "command not in frame" hint (applies in containers too)
      const inShell = /(?:^|\/)(?:ba|z|fi)?sh$/.test(command);
      let containerBin: string | null = null;
      if (inContainer) {
        const detected = await detectContainerRuntime();
        if (!detected) {
          return errorResult(t('cli.open.noRuntime'));
        }
        // A container CLI being present doesn't mean the engine is running (docker version's client part still succeeds with colima stopped / OrbStack closed)
        if (!(await checkContainerDaemon(detected.bin))) {
          return errorResult(t('cli.open.daemonDown'));
        }
        containerBin = detected.bin;
      }

      // terminal_open starts recording by default; verify prerequisites up front to avoid failing after the pty has already launched
      let decoration: RecordDecoration | null =
        decorate === 'terminal' ? { kind: 'terminal' } : null;
      if (decoration && !(await locateFfmpeg())) {
        return errorResult(FFMPEG_MISSING_MESSAGE);
      }

      // In a container, the command runs inside a docker/podman run; caller env travels in via -e.
      const [spawnCommand, spawnArgs]: [string, string[]] = inContainer
        ? containerSpawn(containerBin!, command, args, {
            image: image ?? 'node:22',
            cwd,
            env: extraEnv,
            volumes,
          })
        : [command, args ?? []];

      const view = await TerminalView.open(cols, rows);
      // Decorated recordings fill the 1920×1080 canvas: pick the largest cols×rows that fit the
      // chrome budget so the terminal renders 1:1 instead of being upscaled at stop time. The
      // requested cols/rows only seed the view (cell size is layout-independent); a failed cell
      // measurement falls back to the requested size and the derived-canvas path.
      let ptyCols = cols;
      let ptyRows = rows;
      let fitted = false;
      if (decoration) {
        try {
          const layout = planTerminalLayout(OUTPUT_WIDTH, OUTPUT_HEIGHT, await view.cellSize());
          ptyCols = layout.cols;
          ptyRows = layout.rows;
          fitted = ptyCols !== cols || ptyRows !== rows;
          if (fitted) await view.resize(ptyCols, ptyRows);
          decoration = { kind: 'terminal', canvas: { width: OUTPUT_WIDTH, height: OUTPUT_HEIGHT } };
        } catch {
          // keep the requested cols/rows
        }
      }
      let session: CliSession;
      let recorder: Recorder | null = null;
      try {
        // Start recording before spawning the pty: if spawned first, output may finish rendering before the recorder starts and never repaint, leaving content missing from the video
        recorder = await Recorder.start(view.page, decoration);
        const pty = ptySpawn(spawnCommand, spawnArgs, {
          name: 'xterm-256color',
          cols: ptyCols,
          rows: ptyRows,
          cwd: cwd ?? process.cwd(),
          env: {
            ...process.env,
            ...extraEnv,
            TERM: 'xterm-256color',
            COLORTERM: 'truecolor',
            FORCE_COLOR: '1',
          } as Record<string, string>,
        });
        session = new CliSession(store.nextId('cli'), new PtySession(pty));
        session.view = view;
        session.pty.view = view; // forward pty output to the replay page
        session.recorder = recorder;
        store.add(session);
      } catch (e) {
        await recorder?.dispose();
        await view.close();
        throw new Error(t('cli.open.startFail', { message: e instanceof Error ? e.message : String(e) }));
      }
      return textResult(
        t('cli.open.result', {
          command,
          note: inContainer
            ? t('cli.open.containerNote', { image: image ?? 'node:22' })
            : '',
          id: session.id,
        }) +
          (inShell
            ? ''
            : t('cli.open.shellHint')) +
          (fitted
            ? t('cli.open.fitNote', { cols: ptyCols, rows: ptyRows })
            : ''),
      );
    }),
  );

  server.registerTool(
    'terminal_read',
    {
      title: t('cli.read.title'),
      description: t('cli.read.desc'),
      inputSchema: {
        lines: z.number().int().min(1).max(500).optional().default(50).describe(t('field.lines')),
        sessionId: sessionIdField('cli'),
      },
    },
    handle(async ({ lines, sessionId }) => {
      const session = store.get<CliSession>('cli', sessionId);
      return textResult(session.pty.recentText(lines));
    }),
  );

  server.registerTool(
    'terminal_send',
    {
      title: t('cli.send.title'),
      description: t('cli.send.desc'),
      inputSchema: {
        text: z.string().describe(t('field.writtenText')),
        submit: z.boolean().optional().default(false).describe(t('field.submit')),
        sessionId: sessionIdField('cli'),
      },
    },
    handle(async ({ text, submit, sessionId }) => {
      const session = store.get<CliSession>('cli', sessionId);
      session.pty.write(text + (submit ? '\r' : ''));
      return textResult(t('cli.send.result', { enter: submit ? t('common.andEnter') : '' }));
    }),
  );

  server.registerTool(
    'terminal_send_key',
    {
      title: t('cli.sendKey.title'),
      description: t('cli.sendKey.desc'),
      inputSchema: {
        key: z.string().describe(t('field.keyName')),
        sessionId: sessionIdField('cli'),
      },
    },
    handle(async ({ key, sessionId }) => {
      const session = store.get<CliSession>('cli', sessionId);
      const mapped = mapKey(key);
      if (mapped === null) return errorResult(t('cli.sendKey.unknown', { key }));
      session.pty.write(mapped);
      return textResult(t('cli.sendKey.result', { key }));
    }),
  );

  server.registerTool(
    'terminal_wait',
    {
      title: t('cli.wait.title'),
      description: t('cli.wait.desc'),
      inputSchema: {
        contains: z.string().describe(t('field.contains')),
        timeoutMs: z.number().int().min(500).max(120_000).optional().default(30_000).describe(t('field.timeoutMs')),
        sessionId: sessionIdField('cli'),
      },
    },
    handle(async ({ contains, timeoutMs, sessionId }) => {
      const session = store.get<CliSession>('cli', sessionId);
      const matched = await session.pty.waitText(contains, timeoutMs ?? 30_000);
      return textResult(
        t(
          matched
            ? 'cli.wait.matched'
            : session.pty.exited
              ? 'cli.wait.exited'
              : 'cli.wait.timeout',
          matched ? { needle: contains } : { ms: timeoutMs ?? 30_000, needle: contains },
        ) +
          '\n\n' +
          session.pty.recentText(50),
      );
    }),
  );

  registerRecordStopTool(server, store, {
    name: 'terminal_record_stop',
    title: t('cli.recordStop.title'),
    description: t('cli.recordStop.desc'),
    kind: 'cli',
    filePrefix: 'terminal',
    missingMessage: t('err.noRecording'),
  });

  server.registerTool(
    'terminal_stop',
    {
      title: t('cli.stop.title'),
      description: t('cli.stop.desc'),
      inputSchema: { sessionId: sessionIdField('cli') },
    },
    handle(async ({ sessionId }) => {
      const session = store.get<CliSession>('cli', sessionId);
      const code = await session.pty.stop();
      return textResult(t('cli.stop.result', { code }));
    }),
  );

  registerCloseTool(server, store, {
    name: 'terminal_close',
    title: t('cli.close.title'),
    description: t('cli.close.desc'),
    kind: 'cli',
  });
}
