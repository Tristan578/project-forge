#!/usr/bin/env node
/**
 * `npm run relay` — start the loopback relay the MCP server dials (#9293).
 *
 *   MCP_RELAY_TOKEN=<secret> npm run relay          (required)
 *   MCP_RELAY_PORT=3001                              (default)
 *
 * Then open the editor with `?mcp=<secret>` and start the MCP server with the
 * same MCP_RELAY_TOKEN. See docs/guides/mcp-server-setup.md.
 */
import { startRelay, MissingRelayTokenError, RELAY_DEFAULT_PORT } from './server.js';

async function main() {
  const token = process.env.MCP_RELAY_TOKEN ?? '';
  const port = Number(process.env.MCP_RELAY_PORT ?? RELAY_DEFAULT_PORT);
  const relay = await startRelay({ port, token, log: (line) => console.error(`[forge-relay] ${line}`) });
  console.error(`[forge-relay] editor:  open the editor with ?mcp=<MCP_RELAY_TOKEN>`);
  console.error(`[forge-relay] agent:   FORGE_EDITOR_WS_URL=ws://127.0.0.1:${relay.port}/api/mcp/ws MCP_RELAY_TOKEN=<same> node dist/index.js`);
  const shutdown = (signal: string) => {
    console.error(`[forge-relay] ${signal}, shutting down`);
    relay.close().finally(() => process.exit(0));
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  if (err instanceof MissingRelayTokenError) {
    console.error(`[forge-relay] ${err.message}`);
    console.error('[forge-relay] Generate one with: openssl rand -hex 32');
    process.exit(1);
  }
  console.error('[forge-relay] fatal:', err);
  process.exit(1);
});
