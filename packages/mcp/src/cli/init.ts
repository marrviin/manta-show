import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as p from '@clack/prompts';
import { t } from '../i18n/index.js';
import { runEnvironmentSetup } from './deps.js';
import { printBanner } from './banner.js';

type InstallResult = 'added' | 'exists';

export interface McpEntry {
  command: string;
  args: string[];
}

/** Whether a recorded entry equals the standard launch command (command exact, args deep-equal) */
export function entriesMatch(entry: McpEntry, standard: McpEntry): boolean {
  return entry.command === standard.command && JSON.stringify(entry.args) === JSON.stringify(standard.args);
}

/** Read state of an agent's manta-show MCP entry */
export type McpEntryState =
  | { state: 'ok'; entry: McpEntry }
  | { state: 'missing' } // no manta-show entry in the config
  | { state: 'malformed' } // entry exists but command/args are unreadable
  | { state: 'parse-error' }; // the whole config file failed to parse

interface AgentSpec {
  name: string;
  configPath: string;
  detect: () => boolean;
  readEntry: () => McpEntryState;
  install: () => InstallResult;
  /** Force rewrite to the standard config, replacing any existing entry (doctor repair) */
  repair: () => InstallResult;
}

const SERVER_NAME = 'manta-show';

/** manta-show's launch command: prefer the real dist/index.js + the current node binary, so PATH isn't required */
export function mcpCommand(): { command: string; args: string[]; real: boolean } {
  // This module lives at dist/cli/init.js (or src/cli/init.ts); the index entry point is one level up
  const indexJs = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    'index.js',
  );
  if (existsSync(indexJs)) {
    return { command: process.execPath, args: [indexJs], real: true };
  }
  // When run from source (tsx src/index.ts init) there is no dist; fall back to the global bin
  return { command: SERVER_NAME, args: [], real: false };
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
  overwrite = false,
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
  if (mcpServers[SERVER_NAME] && !overwrite) return 'exists';
  mcpServers[SERVER_NAME] = server;
  json.mcpServers = mcpServers;
  mkdirSync(path.dirname(configPath), { recursive: true });
  writeFileSync(configPath, JSON.stringify(json, null, 2) + '\n');
  return 'added';
}

/** Remove the [mcp_servers.manta-show] section (up to the next TOML section header), for repair */
function stripTomlSection(text: string): string {
  const lines = text.split('\n');
  const start = lines.findIndex((l) =>
    new RegExp(`^\\s*\\[mcp_servers\\.${SERVER_NAME}\\]`).test(l),
  );
  if (start === -1) return text;
  let end = start + 1;
  while (end < lines.length && !/^\s*\[/.test(lines[end])) end++;
  lines.splice(start, end - start);
  return lines.join('\n');
}

/** Append an mcp_servers section to Codex's config.toml (append-only, never rewrites existing content) */
function updateTomlMcp(
  configPath: string,
  cmd: { command: string; args: string[] },
  overwrite = false,
): InstallResult {
  let text = existsSync(configPath) ? readFileSync(configPath, 'utf8') : '';
  const hasSection = new RegExp(`^\\s*\\[mcp_servers\\.${SERVER_NAME}\\]`, 'm').test(text);
  if (hasSection) {
    if (!overwrite) return 'exists';
    text = stripTomlSection(text);
  }
  if (text && !text.endsWith('\n')) text += '\n';
  text += `\n[mcp_servers.${SERVER_NAME}]\ncommand = ${JSON.stringify(cmd.command)}\nargs = ${JSON.stringify(cmd.args)}\n`;
  mkdirSync(path.dirname(configPath), { recursive: true });
  writeFileSync(configPath, text);
  return 'added';
}

/** Read the manta-show entry back out of a JSON agent config */
function jsonReadMcp(configPath: string): McpEntryState {
  if (!existsSync(configPath)) return { state: 'missing' };
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>;
  } catch {
    return { state: 'parse-error' };
  }
  const raw = (json.mcpServers as Record<string, unknown> | undefined)?.[SERVER_NAME];
  if (!raw || typeof raw !== 'object') return { state: 'missing' };
  const command = typeof (raw as Record<string, unknown>).command === 'string' ? (raw as { command: string }).command : '';
  const args = Array.isArray((raw as Record<string, unknown>).args)
    ? (raw as { args: unknown[] }).args.filter((a): a is string => typeof a === 'string')
    : [];
  return command ? { state: 'ok', entry: { command, args } } : { state: 'malformed' };
}

/** Read the manta-show section back out of Codex's config.toml */
function tomlReadMcp(configPath: string): McpEntryState {
  if (!existsSync(configPath)) return { state: 'missing' };
  const lines = readFileSync(configPath, 'utf8').split('\n');
  const start = lines.findIndex((l) =>
    new RegExp(`^\\s*\\[mcp_servers\\.${SERVER_NAME}\\]`).test(l),
  );
  if (start === -1) return { state: 'missing' };
  let command = '';
  let args: string[] = [];
  for (let i = start + 1; i < lines.length && !/^\s*\[/.test(lines[i]); i++) {
    const cmdMatch = /^\s*command\s*=\s*"((?:[^"\\]|\\.)*)"/.exec(lines[i]);
    if (cmdMatch) {
      try {
        command = JSON.parse(`"${cmdMatch[1]}"`) as string;
      } catch {
        command = cmdMatch[1];
      }
    }
    const argsMatch = /^\s*args\s*=\s*(\[[^\]]*\])\s*$/.exec(lines[i]);
    if (argsMatch) {
      try {
        args = (JSON.parse(argsMatch[1]) as unknown[]).filter((a): a is string => typeof a === 'string');
      } catch {
        // leave args empty; a command without readable args still counts as readable
      }
    }
  }
  return command ? { state: 'ok', entry: { command, args } } : { state: 'malformed' };
}

function buildAgents(
  home: string,
  cmd: { command: string; args: string[] },
): AgentSpec[] {
  const jsonCmd = { type: 'stdio', ...cmd };
  return [
    {
      name: 'Claude Code',
      configPath: path.join(home, '.claude.json'),
      detect: () =>
        existsSync(path.join(home, '.claude.json')) ||
        existsSync(path.join(home, '.claude')) ||
        which('claude'),
      readEntry: () => jsonReadMcp(path.join(home, '.claude.json')),
      install: () => updateJsonMcp(path.join(home, '.claude.json'), jsonCmd),
      repair: () => updateJsonMcp(path.join(home, '.claude.json'), jsonCmd, true),
    },
    {
      name: 'Cursor',
      configPath: path.join(home, '.cursor', 'mcp.json'),
      detect: () =>
        existsSync(path.join(home, '.cursor')) || which('cursor'),
      readEntry: () => jsonReadMcp(path.join(home, '.cursor', 'mcp.json')),
      install: () => updateJsonMcp(path.join(home, '.cursor', 'mcp.json'), cmd),
      repair: () => updateJsonMcp(path.join(home, '.cursor', 'mcp.json'), cmd, true),
    },
    {
      name: 'Gemini CLI',
      // Only trust executables on PATH: leftover directories like ~/.gemini don't mean it's still in use
      detect: () => which('gemini'),
      configPath: path.join(home, '.gemini', 'settings.json'),
      readEntry: () => jsonReadMcp(path.join(home, '.gemini', 'settings.json')),
      install: () =>
        updateJsonMcp(path.join(home, '.gemini', 'settings.json'), cmd),
      repair: () =>
        updateJsonMcp(path.join(home, '.gemini', 'settings.json'), cmd, true),
    },
    {
      name: 'Codex',
      detect: () => which('codex'),
      configPath: path.join(home, '.codex', 'config.toml'),
      readEntry: () => tomlReadMcp(path.join(home, '.codex', 'config.toml')),
      install: () => updateTomlMcp(path.join(home, '.codex', 'config.toml'), cmd),
      repair: () => updateTomlMcp(path.join(home, '.codex', 'config.toml'), cmd, true),
    },
    {
      name: 'JoyCode',
      detect: () => existsSync(path.join(home, '.joycode')) || which('joycode'),
      configPath: path.join(home, '.joycode', 'joycode-mcp.json'),
      readEntry: () => jsonReadMcp(path.join(home, '.joycode', 'joycode-mcp.json')),
      install: () => updateJsonMcp(path.join(home, '.joycode', 'joycode-mcp.json'), jsonCmd),
      repair: () => updateJsonMcp(path.join(home, '.joycode', 'joycode-mcp.json'), jsonCmd, true),
    },
  ];
}

export interface AgentStatus {
  name: string;
  detected: boolean;
  configPath: string;
  entryState: McpEntryState;
  /** Recorded command/args when entryState is 'ok', null otherwise */
  entry: McpEntry | null;
}

/** Reused by doctor: list each Agent's install detection and config state (compared against the standard command) */
export function listAgentStatuses(): AgentStatus[] {
  const agents = buildAgents(homedir(), mcpCommand());
  return agents.map((a) => {
    const entryState = a.readEntry();
    return {
      name: a.name,
      detected: a.detect(),
      configPath: a.configPath.replace(homedir(), '~'),
      entryState,
      entry: entryState.state === 'ok' ? entryState.entry : null,
    };
  });
}

/** Force-rewrite every detected agent whose entry is stale or malformed to the standard config; returns the repaired count */
export async function repairMcpConfigs(statuses: AgentStatus[]): Promise<number> {
  const cmd = mcpCommand();
  const agents = buildAgents(homedir(), cmd);
  const byName = new Map(statuses.map((s) => [s.name, s]));
  let repaired = 0;
  for (const agent of agents) {
    const status = byName.get(agent.name);
    if (!status?.detected) continue;
    if (status.entryState.state === 'parse-error') continue; // can't rewrite a file that doesn't parse
    const needsRewrite =
      status.entryState.state === 'malformed' ||
      (status.entryState.state === 'ok' && !entriesMatch(status.entryState.entry, cmd));
    if (!needsRewrite) continue;
    try {
      if (agent.repair() === 'added') repaired++;
    } catch (e) {
      p.log.error(t('init.agentError', { name: agent.name, message: e instanceof Error ? e.message : String(e) }));
    }
  }
  return repaired;
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
