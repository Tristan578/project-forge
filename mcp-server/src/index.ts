#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerTools } from './tools/generated.js';
import { registerResources } from './resources/index.js';
import { registerDocs } from './docs/index.js';
import { EditorBridge } from './transport/websocket.js';
import { startHttpTransport, MissingTokenError } from './transport/http.js';
import manifest from '../manifest/commands.json' with { type: 'json' };

const SERVER_NAME = 'spawnforge';
const SERVER_VERSION = '0.1.0';

function buildServer(bridge: EditorBridge): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  registerTools(server, bridge);
  registerResources(server, bridge);
  registerDocs(server);

  return server;
}

async function main() {
  const editorUrl = process.env.FORGE_EDITOR_WS_URL ?? 'ws://localhost:3001/api/mcp/ws';
  const bridge = new EditorBridge(editorUrl);

  const transportMode = (process.env.MCP_TRANSPORT ?? 'stdio').toLowerCase();

  if (transportMode === 'http') {
    const port = Number(process.env.MCP_HTTP_PORT ?? 3030);
    const host = process.env.MCP_HTTP_HOST ?? '0.0.0.0';
    const stateless = process.env.MCP_HTTP_STATELESS === '1';
    const commands = (manifest as { commands?: unknown[] }).commands ?? [];

    const running = await startHttpTransport(() => buildServer(bridge), {
      port,
      host,
      token: process.env.MCP_HTTP_TOKEN ?? '',
      stateless,
      rateLimit: {
        windowMs: 5 * 60_000,
        max: 30,
      },
      meta: {
        name: SERVER_NAME,
        version: SERVER_VERSION,
        commandCount: commands.length,
      },
    });

    console.error(`[forge-mcp] HTTP transport listening on http://${host}:${running.port}`);
    console.error(`[forge-mcp]   POST /mcp     — JSON-RPC requests (Bearer auth required)`);
    console.error(`[forge-mcp]   GET  /mcp     — SSE stream (Bearer auth required)`);
    console.error(`[forge-mcp]   GET  /health  — liveness probe (no auth)`);
    console.error(`[forge-mcp]   session mode: ${stateless ? 'stateless' : 'stateful'}`);

    const shutdown = (signal: string) => {
      console.error(`[forge-mcp] Received ${signal}, shutting down`);
      running
        .close()
        .catch((err) => console.error('[forge-mcp] shutdown error:', err))
        .finally(() => process.exit(0));
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } else {
    const server = buildServer(bridge);
    const transport = new StdioServerTransport();
    await server.connect(transport);
  }

  // Attempt to connect to editor (non-blocking — tools will error if bridge isn't connected)
  bridge.connect().catch((err) => {
    console.error(`[forge-mcp] Editor bridge connection failed: ${err.message}`);
    console.error('[forge-mcp] Tools will work once the editor is running at', editorUrl);
  });
}

main().catch((err) => {
  if (err instanceof MissingTokenError) {
    console.error(`[forge-mcp] ${err.message}`);
    console.error('[forge-mcp] Generate one with: openssl rand -hex 32');
    process.exit(1);
  }
  console.error('Fatal error:', err);
  process.exit(1);
});
