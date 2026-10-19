#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
// First import: applies ~/.manta-show/config.json env overrides before i18n resolves its locale
import './util/envconfig.js';
import { t } from './i18n/index.js';
import { createServer } from './server.js';
import { runInit } from './cli/init.js';
import { runDoctor } from './cli/doctor.js';
import { runClean } from './cli/clean.js';
import { runRecordings } from './cli/recordings.js';
import { runSet } from './cli/set.js';

const args = process.argv.slice(2);

const showVersion = (): void => {
  const pkg = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  ) as { name: string; version: string; description?: string };
  console.log(`${pkg.name} v${pkg.version}`);
};

const showHelp = (): never => {
  console.log(t('cliEntry.help'));
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
  set: (rest) => runSet(rest),
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
    console.error(t('cliEntry.unknownArg', { arg }));
  }
}

const { server, store } = createServer();
store.startReaper();

// Host shutdown (MCP client restart / Ctrl+C): close sessions so pty and Chromium children don't
// linger as orphans; force-exit if closing hangs.
let closing = false;
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    if (closing) {
      process.exit(0);
    }
    closing = true;
    const force = setTimeout(() => process.exit(0), 3_000);
    force.unref?.();
    void store.closeAll().finally(() => process.exit(0));
  });
}

await server.connect(new StdioServerTransport());
console.error(t('cliEntry.started'));
