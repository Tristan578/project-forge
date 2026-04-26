import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type {
  jsonSchemaValidator,
  JsonSchemaType,
  JsonSchemaValidator,
} from '@modelcontextprotocol/sdk/validation/types.js';
import { z } from 'zod';
import { startHttpTransport, MissingTokenError, type RunningHttpServer } from '../http.js';

const TEST_TOKEN = 'test-token-deadbeef';

// Bypass AJV in tests — vitest's ESM resolver mishandles ajv-formats' default
// import, breaking the SDK's default validator. The transport tests don't
// exercise schema validation, so a permissive no-op is safe here.
const noopValidator: jsonSchemaValidator = {
  getValidator<T>(_schema: JsonSchemaType): JsonSchemaValidator<T> {
    return (input: unknown) => ({ valid: true, data: input as T, errorMessage: undefined });
  },
};

function buildTestServer(): McpServer {
  const server = new McpServer(
    { name: 'test-server', version: '0.0.0' },
    { jsonSchemaValidator: noopValidator },
  );
  server.registerTool(
    'echo',
    {
      title: 'Echo',
      description: 'Returns its input',
      inputSchema: { value: z.string() },
    },
    async ({ value }) => ({
      content: [{ type: 'text', text: value }],
    }),
  );
  return server;
}

async function bootHttp(overrides: { stateless?: boolean; max?: number } = {}): Promise<RunningHttpServer> {
  return startHttpTransport(buildTestServer, {
    port: 0,
    host: '127.0.0.1',
    token: TEST_TOKEN,
    stateless: overrides.stateless ?? true,
    rateLimit: { windowMs: 60_000, max: overrides.max ?? 100 },
    meta: { name: 'test-server', version: '0.0.0', commandCount: 1 },
  });
}

async function jsonRpc(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; json: unknown }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...headers,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  return { status: res.status, json };
}

describe('startHttpTransport', () => {
  let running: RunningHttpServer | null = null;

  afterEach(async () => {
    if (running) {
      await running.close();
      running = null;
    }
  });

  it('refuses to start without a token', async () => {
    await expect(
      startHttpTransport(buildTestServer, {
        port: 0,
        host: '127.0.0.1',
        token: '',
        stateless: true,
        rateLimit: { windowMs: 60_000, max: 10 },
        meta: { name: 'x', version: '0', commandCount: 0 },
      }),
    ).rejects.toThrow(MissingTokenError);
  });

  describe('GET /health', () => {
    beforeEach(async () => {
      running = await bootHttp();
    });

    it('returns server metadata without auth', async () => {
      const res = await fetch(`http://127.0.0.1:${running!.port}/health`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toMatchObject({
        status: 'ok',
        name: 'test-server',
        version: '0.0.0',
        commandCount: 1,
        transport: 'http',
        sessionMode: 'stateless',
      });
      expect(body.uptimeSeconds).toBeTypeOf('number');
    });
  });

  describe('auth', () => {
    beforeEach(async () => {
      running = await bootHttp();
    });

    it('rejects POST /mcp with no Authorization header', async () => {
      const { status } = await jsonRpc(`http://127.0.0.1:${running!.port}/mcp`, {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
      });
      expect(status).toBe(401);
    });

    it('rejects POST /mcp with wrong token', async () => {
      const { status } = await jsonRpc(
        `http://127.0.0.1:${running!.port}/mcp`,
        { jsonrpc: '2.0', id: 1, method: 'tools/list' },
        { Authorization: 'Bearer wrong' },
      );
      expect(status).toBe(401);
    });

    it('rejects malformed Authorization header', async () => {
      const { status } = await jsonRpc(
        `http://127.0.0.1:${running!.port}/mcp`,
        { jsonrpc: '2.0', id: 1, method: 'tools/list' },
        { Authorization: TEST_TOKEN },
      );
      expect(status).toBe(401);
    });

    it('returns 404 on unknown paths', async () => {
      const res = await fetch(`http://127.0.0.1:${running!.port}/unknown`);
      expect(res.status).toBe(404);
    });
  });

  describe('JSON-RPC round-trip', () => {
    beforeEach(async () => {
      running = await bootHttp({ stateless: true });
    });

    it('serves initialize then tools/list with valid token', async () => {
      const initRes = await jsonRpc(
        `http://127.0.0.1:${running!.port}/mcp`,
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-06-18',
            capabilities: {},
            clientInfo: { name: 'test-client', version: '0.0.0' },
          },
        },
        { Authorization: `Bearer ${TEST_TOKEN}` },
      );
      expect(initRes.status).toBe(200);
      expect((initRes.json as { result: unknown }).result).toBeDefined();

      const listRes = await jsonRpc(
        `http://127.0.0.1:${running!.port}/mcp`,
        { jsonrpc: '2.0', id: 2, method: 'tools/list' },
        { Authorization: `Bearer ${TEST_TOKEN}` },
      );
      expect(listRes.status).toBe(200);
      const result = (listRes.json as { result: { tools: Array<{ name: string }> } }).result;
      expect(result.tools).toBeDefined();
      expect(result.tools.some((t) => t.name === 'echo')).toBe(true);
    });
  });

  describe('rate limiting', () => {
    it('returns 429 once the per-IP budget is spent', async () => {
      running = await bootHttp({ stateless: true, max: 2 });

      const send = () =>
        jsonRpc(
          `http://127.0.0.1:${running!.port}/mcp`,
          { jsonrpc: '2.0', id: 1, method: 'tools/list' },
          { Authorization: `Bearer ${TEST_TOKEN}` },
        );

      const first = await send();
      const second = await send();
      const third = await send();

      // First two consume the budget (status 200 — handler runs even if not initialized);
      // third trips the limiter before the handler.
      expect([first.status, second.status]).not.toContain(429);
      expect(third.status).toBe(429);
    });
  });
});
