#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';
import { runInit } from './cli/init.js';
import { runDoctor } from './cli/doctor.js';
import { runClean } from './cli/clean.js';
import { runRecordings } from './cli/recordings.js';

const args = process.argv.slice(2);

const showVersion = (): void => {
  const pkg = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  ) as { name: string; version: string; description?: string };
  console.log(`${pkg.name} v${pkg.version}`);
};

const showHelp = (): never => {
  console.log(`manta-show - MCP server for AI agents: capture screenshots and videos of web pages, Electron apps and CLI tools.

Usage: manta-show [options]

Options:
  -v, --version    Print version and exit
  -h, --help       Show this help and exit
  init             Detect installed AI agents (Claude Code, Cursor,
                   Gemini CLI, Codex) and register the manta-show MCP server
                   in their configs
  doctor [--deep]  Check local environment (Node, ffmpeg, Chromium, output
                   dir, MCP configs) and offer to fix issues interactively;
                   --deep also runs a real capture test (screenshot + mp4)
  recordings       List recent media artifacts in the output dir
                   (--last for only the newest, --open to open it)
  clean            Show output dir usage; delete with --older-than 7d
                   (or 24h / 30m) or --all; add -y to skip confirmation

Without options, starts the MCP server on stdio.`);
  process.exit(0);
};

const flags: Record<string, () => void | Promise<void>> = {
  '--version': showVersion,
  '-v': showVersion,
  '--help': showHelp,
  '-h': showHelp,
};

const commands: Record<string, (rest: string[]) => void | Promise<void>> = {
  init: () => runInit(),
  '--init': () => runInit(),
  doctor: (rest) => runDoctor(rest),
  '--doctor': (rest) => runDoctor(rest),
  clean: (rest) => runClean(rest),
  recordings: (rest) => runRecordings(rest),
};

// A command consumes the rest of argv (its own flags); global flags like -v/-h stand alone
const commandIndex = args.findIndex((arg) => arg in commands);
if (commandIndex !== -1) {
  const name = args[commandIndex];
  const rest = args.slice(commandIndex + 1);
  await commands[name](rest);
  process.exit(0);
}

for (const arg of args) {
  const handler = flags[arg];
  if (handler) {
    await handler();
    process.exit(0);
  }
  if (arg.startsWith('-')) {
    console.error(`[manta-show] 未知参数 "${arg}"，已忽略。用 --help 查看可用参数。`);
  }
}

const { server, store } = createServer();
store.startReaper();

await server.connect(new StdioServerTransport());
console.error('[manta-show] MCP server 已启动（stdio）');
