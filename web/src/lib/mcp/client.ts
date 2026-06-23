/**
 * SpawnForge MCP client (AI SDK / `@ai-sdk/mcp`).
 *
 * Connects to the SpawnForge MCP server's Streamable HTTP transport
 * (`mcp-server/src/transport/http.ts`, the `POST /mcp` endpoint) using the
 * AI SDK MCP client. The server registers all 350 commands from
 * `manifest/commands.json`, so the client is the live source of truth for the
 * tool surface.
 *
 * IMPORTANT — this is NOT the chat agent's tool source.
 * The chat agent (`createSpawnforgeAgent`) builds its tools statically from the
 * bundled `@/data/commands.json` and attaches NO execute functions, because tool
 * calls are forwarded to the browser to run against the WASM engine. An MCP
 * client's tools carry execute functions that run against the *server's*
 * `EditorBridge` — wiring those into the chat agent would both regress the
 * browser-forwarding model and add a per-request network hop to the hot path.
 * So this client is used for OUT-OF-BAND work — chiefly the tool-parity guard
 * (`./toolParity`) that proves the static manifest stays in sync with the live
 * server. See `docs/decisions/2026-06-23-mcp-client-tool-source.md`.
 *
 * Flag/env-guarded: returns `null` (no-op) unless BOTH `MCP_HTTP_URL` and
 * `MCP_HTTP_TOKEN` are set, mirroring the env-guard pattern used across the app
 * (e.g. `layout.tsx` Clerk-key gating). `MCP_HTTP_TOKEN` must match the
 * `MCP_HTTP_TOKEN` the server authenticates against (Bearer scheme).
 */

import { createMCPClient } from '@ai-sdk/mcp';

export interface McpClientConfig {
  /** Base URL of the MCP server's Streamable HTTP endpoint, e.g. `https://mcp.example.com/mcp`. */
  url: string;
  /** Bearer token; must equal the server's `MCP_HTTP_TOKEN`. */
  token: string;
}

/**
 * Resolve the MCP client config from the environment, or `null` when the
 * integration is not configured. Both vars are required — a URL without a token
 * (or vice versa) is treated as "off", never as a half-configured client.
 */
export function getMcpClientConfig(): McpClientConfig | null {
  const url = process.env.MCP_HTTP_URL?.trim();
  const token = process.env.MCP_HTTP_TOKEN?.trim();
  if (!url || !token) return null;
  return { url, token };
}

/** True when both `MCP_HTTP_URL` and `MCP_HTTP_TOKEN` are present. */
export function isMcpClientConfigured(): boolean {
  return getMcpClientConfig() !== null;
}

export type SpawnforgeMcpClient = Awaited<ReturnType<typeof createMCPClient>>;

/**
 * Create an MCP client connected to the SpawnForge MCP server, or `null` when
 * the integration is not configured (env-guarded no-op).
 *
 * Callers MUST `await client.close()` when done — the Streamable HTTP transport
 * holds a connection. Prefer the `withMcpClient` helper, which guarantees close.
 */
export async function createSpawnforgeMcpClient(
  config: McpClientConfig | null = getMcpClientConfig(),
): Promise<SpawnforgeMcpClient | null> {
  if (!config) return null;
  return createMCPClient({
    transport: {
      type: 'http',
      url: config.url,
      headers: { Authorization: `Bearer ${config.token}` },
    },
  });
}

/**
 * Run `fn` with a live MCP client, always closing it afterward. Resolves to
 * `null` (without calling `fn`) when the integration is not configured.
 */
export async function withMcpClient<T>(
  fn: (client: SpawnforgeMcpClient) => Promise<T>,
  config: McpClientConfig | null = getMcpClientConfig(),
): Promise<T | null> {
  const client = await createSpawnforgeMcpClient(config);
  if (!client) return null;
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}
