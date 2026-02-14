#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerTools } from './tools/generated.js';
import { registerResources } from './resources/index.js';
import { registerDocs } from './docs/index.js';
import { EditorBridge } from './transport/websocket.js';

async function main() {
  const server = new McpServer({
    name: 'project-forge',
    version: '0.1.0',
  });

  // Editor bridge — connects to the running Next.js editor via WebSocket
  const editorUrl = process.env.FORGE_EDITOR_WS_URL ?? 'ws://localhost:3001/api/mcp/ws';
  const bridge = new EditorBridge(editorUrl);

  // Register all tools from the command manifest
  registerTools(server, bridge);

  // Register MCP resources (scene graph, selection, etc.)
  registerResources(server, bridge);

  // Register documentation resources and tools
  registerDocs(server);

  // Connect via stdio (for Claude Desktop / Claude Code)
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Attempt to connect to editor (non-blocking — tools will error if bridge isn't connected)
  bridge.connect().catch((err) => {
    console.error(`[forge-mcp] Editor bridge connection failed: ${err.message}`);
    console.error('[forge-mcp] Tools will work once the editor is running at', editorUrl);
  });
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
