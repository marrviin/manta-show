#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';
import { runInit } from './cli/init.js';
import { runDoctor } from './cli/doctor.js';

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
  init             Detect installed AI agents (Claude Code, Cursor, Windsurf,
                   Gemini CLI, Codex) and register the manta-show MCP server
                   in their configs
  doctor           Check local environment (Node, ffmpeg, Chromium, output
                   dir, MCP configs) and offer to fix issues interactively

Without options, starts the MCP server on stdio.`);
  process.exit(0);
};

const flags: Record<string, () => void | Promise<void>> = {
  '--version': showVersion,
  '-v': showVersion,
  '--help': showHelp,
  '-h': showHelp,
  init: runInit,
  '--init': runInit,
  doctor: runDoctor,
  '--doctor': runDoctor,
};

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
