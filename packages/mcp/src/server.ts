import { readFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { t } from './i18n/index.js';
import { SessionStore } from './session.js';
import { registerWebTools } from './tools/web.js';
import { registerCliTools } from './tools/cli.js';
import { registerElectronTools } from './tools/electron.js';

/** Server identity mirrors the package version (index.ts reads the same file for -v) */
const pkg = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { name: string; version: string };

export function createServer(): { server: McpServer; store: SessionStore } {
  const store = new SessionStore();
  const server = new McpServer(
    { name: 'manta-show', version: pkg.version },
    {
      instructions: t('server.instructions'),
    },
  );
  registerWebTools(server, store);
  registerCliTools(server, store);
  registerElectronTools(server, store);
  return { server, store };
}
