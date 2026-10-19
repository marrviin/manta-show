import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as p from '@clack/prompts';
import { t } from '../i18n/index.js';
import { runEnvironmentSetup } from './deps.js';
import { printBanner } from './banner.js';

type InstallResult = 'added' | 'exists';

interface AgentSpec {
  name: string;
  detect: () => boolean;
  hasConfig: () => boolean;
  install: () => InstallResult;
}

const SERVER_NAME = 'manta-show';

/** manta-show's launch command: prefer the real dist/index.js + the current node binary, so PATH isn't required */
function mcpCommand(): { command: string; args: string[] } {
  // This module lives at dist/cli/init.js (or src/cli/init.ts); the index entry point is one level up
  const indexJs = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    'index.js',
  );
  if (existsSync(indexJs)) {
    return { command: process.execPath, args: [indexJs] };
  }
  // When run from source (tsx src/index.ts init) there is no dist; fall back to the global bin
  return { command: SERVER_NAME, args: [] };
}

/** Whether the binary is on PATH */
function which(name: string): boolean {
  return (process.env.PATH ?? '')
    .split(path.delimiter)
    .some((dir) => dir && existsSync(path.join(dir, name)));
}

/** Write config into a JSON config's mcpServers field (preserving all other content) */
function updateJsonMcp(
  configPath: string,
  server: Record<string, unknown>,
): InstallResult {
  let json: Record<string, unknown> = {};
  if (existsSync(configPath)) {
    const raw = readFileSync(configPath, 'utf8');
    if (raw.trim()) {
      try {
        json = JSON.parse(raw) as Record<string, unknown>;
      } catch (e) {
        throw new Error(t('init.parseFail', { path: configPath, message: e instanceof Error ? e.message : String(e) }));
      }
    }
  }
  const mcpServers = (json.mcpServers ?? {}) as Record<string, unknown>;
  if (mcpServers[SERVER_NAME]) return 'exists';
  mcpServers[SERVER_NAME] = server;
  json.mcpServers = mcpServers;
  mkdirSync(path.dirname(configPath), { recursive: true });
  writeFileSync(configPath, JSON.stringify(json, null, 2) + '\n');
  return 'added';
}

/** Append an mcp_servers section to Codex's config.toml (append-only, never rewrites existing content) */
function updateTomlMcp(
  configPath: string,
  cmd: { command: string; args: string[] },
): InstallResult {
  let text = existsSync(configPath) ? readFileSync(configPath, 'utf8') : '';
  if (new RegExp(`^\\s*\\[mcp_servers\\.${SERVER_NAME}\\]`, 'm').test(text)) {
    return 'exists';
  }
  if (text && !text.endsWith('\n')) text += '\n';
  text += `\n[mcp_servers.${SERVER_NAME}]\ncommand = ${JSON.stringify(cmd.command)}\nargs = ${JSON.stringify(cmd.args)}\n`;
  mkdirSync(path.dirname(configPath), { recursive: true });
  writeFileSync(configPath, text);
  return 'added';
}

/** Whether the config file already has an mcpServers entry for manta-show */
function jsonHasMcp(configPath: string): boolean {
  if (!existsSync(configPath)) return false;
  try {
    const json = JSON.parse(readFileSync(configPath, 'utf8')) as {
      mcpServers?: Record<string, unknown>;
    };
    return Boolean(json.mcpServers?.[SERVER_NAME]);
  } catch {
    return false;
  }
}

/** Whether config.toml already has an mcp_servers section for manta-show */
function tomlHasMcp(configPath: string): boolean {
  if (!existsSync(configPath)) return false;
  return new RegExp(`^\\s*\\[mcp_servers\\.${SERVER_NAME}\\]`, 'm').test(
    readFileSync(configPath, 'utf8'),
  );
}

function buildAgents(
  home: string,
  cmd: { command: string; args: string[] },
): AgentSpec[] {
  const jsonCmd = { type: 'stdio', ...cmd };
  return [
    {
      name: 'Claude Code',
      detect: () =>
        existsSync(path.join(home, '.claude.json')) ||
        existsSync(path.join(home, '.claude')) ||
        which('claude'),
      hasConfig: () => jsonHasMcp(path.join(home, '.claude.json')),
      install: () => updateJsonMcp(path.join(home, '.claude.json'), jsonCmd),
    },
    {
      name: 'Cursor',
      detect: () =>
        existsSync(path.join(home, '.cursor')) || which('cursor'),
      hasConfig: () =>
        jsonHasMcp(path.join(home, '.cursor', 'mcp.json')),
      install: () => updateJsonMcp(path.join(home, '.cursor', 'mcp.json'), cmd),
    },
    {
      name: 'Gemini CLI',
      // Only trust executables on PATH: leftover directories like ~/.gemini don't mean it's still in use
      detect: () => which('gemini'),
      hasConfig: () =>
        jsonHasMcp(path.join(home, '.gemini', 'settings.json')),
      install: () =>
        updateJsonMcp(path.join(home, '.gemini', 'settings.json'), cmd),
    },
    {
      name: 'Codex',
      detect: () => which('codex'),
      hasConfig: () => tomlHasMcp(path.join(home, '.codex', 'config.toml')),
      install: () => updateTomlMcp(path.join(home, '.codex', 'config.toml'), cmd),
    },
  ];
}

export interface AgentStatus {
  name: string;
  detected: boolean;
  configured: boolean;
}

/** Reused by doctor: list each Agent's install detection and config status */
export function listAgentStatuses(): AgentStatus[] {
  const agents = buildAgents(homedir(), mcpCommand());
  return agents.map((a) => ({
    name: a.name,
    detected: a.detect(),
    configured: a.hasConfig(),
  }));
}

export async function runInit(): Promise<void> {
  const agents = buildAgents(homedir(), mcpCommand());

  printBanner();
  p.intro(t('init.intro'));
  let installed = 0;
  let skipped = 0;
  for (const agent of agents) {
    if (!agent.detect()) {
      p.log.step(t('init.notDetected', { name: agent.name }));
      continue;
    }
    try {
      const result = agent.install();
      if (result === 'added') {
        installed++;
        p.log.success(t('init.added', { name: agent.name, server: SERVER_NAME }));
      } else {
        skipped++;
        p.log.info(t('init.exists', { name: agent.name }));
      }
    } catch (e) {
      p.log.error(t('init.agentError', { name: agent.name, message: e instanceof Error ? e.message : String(e) }));
    }
  }
  p.outro(t('init.outro', { installed, skipped }));

  // Continue onboarding: check the capture deps and offer to install what is missing (Chromium, ffmpeg; container runtime is info-only)
  await runEnvironmentSetup();
}
