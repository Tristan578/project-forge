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

// Stateful mode returns SSE (event-stream) by default. This helper parses the
// `data:` payload of the first event so callers can assert on the JSON-RPC
// envelope regardless of which transport mode the server picked.
async function jsonRpcSse(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; sessionId: string | null; json: unknown }> {
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
  // Header name is case-insensitive in fetch; `Headers.get` already normalizes.
  const sessionId = res.headers.get('Mcp-Session-Id') ?? res.headers.get('mcp-session-id');
  // Try JSON first (server may have switched to enableJsonResponse), then SSE.
  try {
    return { status: res.status, sessionId, json: text.length > 0 ? JSON.parse(text) : null };
  } catch {
    // SSE format: lines like `event: message\ndata: {...}\n\n`. Grab the first
    // data: payload — for the round-trip test there's exactly one.
    const dataLine = text.split('\n').find((line) => line.startsWith('data:'));
    if (!dataLine) {
      return { status: res.status, sessionId, json: { raw: text } };
    }
    try {
      return { status: res.status, sessionId, json: JSON.parse(dataLine.slice(5).trim()) };
    } catch {
      return { status: res.status, sessionId, json: { raw: text } };
    }
  }
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

    it('routes /health correctly when a query string is appended', async () => {
      // Load balancers commonly append cache-busting params to health probes.
      // The handler must strip the query string before routing.
      const res = await fetch(`http://127.0.0.1:${running!.port}/health?ts=12345`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.status).toBe('ok');
    });

    it('routes /mcp correctly when a query string is appended', async () => {
      // Some MCP clients append a session/tracing query string. Should still
      // hit the /mcp path-matcher and proceed past auth (here it 401s with no
      // bearer, proving the route was matched, not 404).
      const { status } = await jsonRpc(
        `http://127.0.0.1:${running!.port}/mcp?session=abc`,
        { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      );
      expect(status).toBe(401);
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

  describe('JSON-RPC round-trip — stateful mode', () => {
    // Stateful is the default in production. The route pre-reads the request
    // body before passing it to `transport.handleRequest(req, res, body)` so it
    // can enforce a size cap before the SDK consumes the stream. This test
    // proves the SDK's stateful StreamableHTTPServerTransport accepts the
    // pre-parsed body — without this coverage, a SDK upgrade that started
    // re-reading the stream would fail every default-config POST in production.
    beforeEach(async () => {
      running = await bootHttp({ stateless: false });
    });

    it('serves initialize then tools/list and tracks the session', async () => {
      const initRes = await jsonRpcSse(
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
      // Stateful mode mints a session ID on initialize and echoes it back via
      // the response header. A non-null value here proves the SDK consumed the
      // pre-parsed body and ran the initialize handshake to completion.
      expect(initRes.sessionId).toBeTruthy();
      expect((initRes.json as { result: unknown }).result).toBeDefined();

      const sessionId = initRes.sessionId!;
      const listRes = await jsonRpcSse(
        `http://127.0.0.1:${running!.port}/mcp`,
        { jsonrpc: '2.0', id: 2, method: 'tools/list' },
        { Authorization: `Bearer ${TEST_TOKEN}`, 'Mcp-Session-Id': sessionId },
      );
      expect(listRes.status).toBe(200);
      const result = (listRes.json as { result: { tools: Array<{ name: string }> } }).result;
      expect(result.tools.some((t) => t.name === 'echo')).toBe(true);
    });
  });

  describe('error handling', () => {
    it('returns 500 (does not crash) when stateless buildServer throws', async () => {
      // The CRITICAL bug fixed alongside this test: in stateless mode,
      // `await mcpServer.connect(transport)` lived outside any try/catch,
      // so a build/connect failure would surface as an unhandled promise
      // rejection and tear the server process down. We now catch and respond.
      let calls = 0;
      const failingBuilder = (): McpServer => {
        calls++;
        throw new Error('synthetic build failure');
      };

      running = await startHttpTransport(failingBuilder, {
        port: 0,
        host: '127.0.0.1',
        token: TEST_TOKEN,
        stateless: true,
        rateLimit: { windowMs: 60_000, max: 100 },
        meta: { name: 'test-server', version: '0.0.0', commandCount: 1 },
      });

      const { status, json } = await jsonRpc(
        `http://127.0.0.1:${running.port}/mcp`,
        { jsonrpc: '2.0', id: 1, method: 'tools/list' },
        { Authorization: `Bearer ${TEST_TOKEN}` },
      );

      expect(status).toBe(500);
      expect((json as { error: string }).error).toContain('synthetic build failure');
      expect(calls).toBe(1);

      // Server still alive — second request also gets a clean 500.
      const second = await jsonRpc(
        `http://127.0.0.1:${running.port}/mcp`,
        { jsonrpc: '2.0', id: 2, method: 'tools/list' },
        { Authorization: `Bearer ${TEST_TOKEN}` },
      );
      expect(second.status).toBe(500);
      expect(calls).toBe(2);
    });

    it('runs cleanup when mcpServer.connect rejects (no resource leak)', async () => {
      // Regression for PR #8512 Sentry MEDIUM: cleanup was registered AFTER
      // connect(), so a connect failure leaked the constructed server +
      // transport (each holds open streams). Repeated failures could exhaust
      // the process. After the fix, res.on('close', cleanup) is wired BEFORE
      // connect() so the listener still fires when the response closes on
      // the 500 we write below.
      let closeCalls = 0;
      let closeResolver!: () => void;
      const closeOnce = new Promise<void>((resolve) => {
        closeResolver = resolve;
      });

      const failingConnectBuilder = (): McpServer => {
        const server = buildTestServer();
        // Shadow connect to fail synchronously after the transport is built.
        // Object property assignment on a class instance is fine — JS resolves
        // method dispatch via the instance first, prototype second.
        Object.defineProperty(server, 'connect', {
          value: async () => {
            throw new Error('synthetic connect failure');
          },
          writable: true,
          configurable: true,
        });
        // Track close so we can prove cleanup fired.
        const originalClose = server.close.bind(server);
        Object.defineProperty(server, 'close', {
          value: async () => {
            closeCalls++;
            closeResolver();
            return originalClose();
          },
          writable: true,
          configurable: true,
        });
        return server;
      };

      running = await startHttpTransport(failingConnectBuilder, {
        port: 0,
        host: '127.0.0.1',
        token: TEST_TOKEN,
        stateless: true,
        rateLimit: { windowMs: 60_000, max: 100 },
        meta: { name: 'test-server', version: '0.0.0', commandCount: 1 },
      });

      const { status, json } = await jsonRpc(
        `http://127.0.0.1:${running.port}/mcp`,
        { jsonrpc: '2.0', id: 1, method: 'tools/list' },
        { Authorization: `Bearer ${TEST_TOKEN}` },
      );

      expect(status).toBe(500);
      expect((json as { error: string }).error).toContain('synthetic connect failure');

      // Wait (with a real timeout, not a sleep) for the close listener to fire.
      // If the cleanup were registered after connect — as it was before the fix —
      // this promise would never resolve and the timeout would fail the test.
      await Promise.race([
        closeOnce,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('cleanup did not run within 500ms — leak regressed')), 500),
        ),
      ]);
      expect(closeCalls).toBeGreaterThan(0);
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
