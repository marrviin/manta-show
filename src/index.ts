#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';

const { server, store } = createServer();
store.startReaper();

await server.connect(new StdioServerTransport());
console.error('[manta-show] MCP server 已启动（stdio）');
