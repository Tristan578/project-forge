/**
 * Streamable HTTP transport for the SpawnForge MCP server.
 *
 * Spec: https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#streamable-http
 *
 * Wire model
 * - `POST /mcp` carries a single JSON-RPC request (`tools/list`, `tools/call`, …)
 *   and returns either a JSON body or an SSE stream — the SDK transport decides.
 * - `GET /mcp` opens the standalone server-to-client SSE channel.
 * - `DELETE /mcp` closes a session.
 * - `GET /health` is a lightweight non-MCP probe (no auth) for load balancers.
 *
 * Auth
 * - Bearer token via the `MCP_HTTP_TOKEN` env var. Constant-time comparison.
 * - The /health endpoint is intentionally unauthenticated.
 *
 * Rate limiting
 * - Per-IP, 30 req / 5 min default (mirrors `rateLimitPublicRoute()` on the web).
 * - Backed by Upstash Redis when `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`
 *   are present and the optional dep is installed; otherwise an in-memory
 *   sliding window applies (suitable for single-instance deployments).
 *
 * Session model
 * - Stateful (default): one shared transport + server. The SDK assigns session
 *   IDs and tracks per-session streams. Clients must send `Mcp-Session-Id` on
 *   every follow-up request.
 * - Stateless (`MCP_HTTP_STATELESS=1`): a fresh transport + server is built per
 *   request and torn down on response close. JSON-only responses, no sessions.
 *   This matches the SDK's own `simpleStatelessStreamableHttp` example and is
 *   the only way the SDK supports concurrent stateless requests safely.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

export interface HttpTransportOptions {
  port: number;
  host: string;
  /** Bearer token. If empty the server refuses to start (fail-closed). */
  token: string;
  stateless: boolean;
  rateLimit: {
    windowMs: number;
    max: number;
  };
  /** Server metadata surfaced on /health. */
  meta: {
    name: string;
    version: string;
    commandCount: number;
  };
}

export interface RunningHttpServer {
  server: Server;
  /** Bound port — useful when caller passed 0 to ask the OS for a free port. */
  port: number;
  close(): Promise<void>;
}

export class MissingTokenError extends Error {
  constructor() {
    super('MCP_HTTP_TOKEN is required when MCP_TRANSPORT=http');
    this.name = 'MissingTokenError';
  }
}

interface RateLimiter {
  /** True if the request is allowed. */
  check(key: string): Promise<boolean>;
}

/**
 * In-memory sliding window — single-process only. Intended for local dev or
 * single-instance deployments. For multi-instance, set the Upstash env vars.
 */
class InMemoryRateLimiter implements RateLimiter {
  private hits = new Map<string, number[]>();

  constructor(
    private readonly windowMs: number,
    private readonly max: number,
  ) {}

  async check(key: string): Promise<boolean> {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((ts) => ts > cutoff);
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }
}

async function tryUpstashLimiter(windowMs: number, max: number): Promise<RateLimiter | null> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;

  try {
    const [{ Ratelimit }, { Redis }] = await Promise.all([
      import('@upstash/ratelimit'),
      import('@upstash/redis'),
    ]);
    const redis = new Redis({ url, token });
    const limiter = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(max, `${Math.round(windowMs / 1000)} s`),
      prefix: 'mcp:http',
    });
    return {
      async check(key: string) {
        try {
          const { success } = await limiter.limit(key);
          return success;
        } catch {
          // Fail open on Redis errors — better to serve than to block on infra hiccup.
          return true;
        }
      },
    };
  } catch {
    // Optional dep not installed — fall back to in-memory.
    return null;
  }
}

function getClientIp(req: IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0]!.trim();
  }
  return req.socket.remoteAddress ?? 'unknown';
}

function bearerOk(headerValue: string | undefined, expected: string): boolean {
  if (!headerValue) return false;
  const match = headerValue.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;
  const provided = Buffer.from(match[1]!.trim(), 'utf8');
  const want = Buffer.from(expected, 'utf8');
  if (provided.length !== want.length) return false;
  return timingSafeEqual(provided, want);
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(json).toString(),
  });
  res.end(json);
}

async function readBody(req: IncomingMessage, maxBytes = 4 * 1024 * 1024): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (raw.length === 0) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

/**
 * Boot an HTTP server fronting the MCP server.
 *
 * `buildServer` is invoked:
 * - Once at startup in stateful mode (a single transport+server pair handles
 *   every request, with session IDs from the SDK).
 * - Per request in stateless mode (the SDK's stateless transport keeps no
 *   cross-request state, so reusing one would cause "already initialized"
 *   errors and orphaned stream handles).
 */
export async function startHttpTransport(
  buildServer: () => McpServer,
  options: HttpTransportOptions,
): Promise<RunningHttpServer> {
  if (!options.token || options.token.trim().length === 0) {
    throw new MissingTokenError();
  }

  const limiter =
    (await tryUpstashLimiter(options.rateLimit.windowMs, options.rateLimit.max)) ??
    new InMemoryRateLimiter(options.rateLimit.windowMs, options.rateLimit.max);

  const startedAt = Date.now();

  // Shared (stateful) transport+server, built once. Null in stateless mode.
  let sharedTransport: StreamableHTTPServerTransport | null = null;
  let sharedServer: McpServer | null = null;
  if (!options.stateless) {
    sharedServer = buildServer();
    sharedTransport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      enableJsonResponse: false,
    });
    await sharedServer.connect(sharedTransport);
  }

  const server = createServer((req, res) => {
    // Wrap the entire async body in a single try/catch and run it via a
    // synchronous IIFE so that any rejection — including the SDK's
    // `connect(transport)` call in stateless mode — is caught here instead of
    // bubbling up as an unhandled promise rejection that would crash the
    // process. Without this, a single failed connect would tear down the whole
    // server.
    void (async () => {
      try {
        // Strip query string from the path: load balancers commonly append
        // cache-busting params like `?ts=...` to health probes, and an exact
        // string match on `req.url` would 404 them.
        const path = new URL(req.url ?? '/', 'http://_').pathname;
        const method = req.method ?? 'GET';

        // /health is intentionally unauthenticated — load balancers and uptime
        // probes need to reach it without provisioning a token.
        if (method === 'GET' && path === '/health') {
          writeJson(res, 200, {
            status: 'ok',
            name: options.meta.name,
            version: options.meta.version,
            commandCount: options.meta.commandCount,
            transport: 'http',
            sessionMode: options.stateless ? 'stateless' : 'stateful',
            uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
          });
          return;
        }

        if (path !== '/mcp') {
          writeJson(res, 404, { error: 'Not Found' });
          return;
        }

        if (!bearerOk(req.headers.authorization, options.token)) {
          res.setHeader('WWW-Authenticate', 'Bearer realm="mcp"');
          writeJson(res, 401, { error: 'Unauthorized' });
          return;
        }

        const ip = getClientIp(req);
        const allowed = await limiter.check(ip);
        if (!allowed) {
          res.setHeader('Retry-After', Math.ceil(options.rateLimit.windowMs / 1000).toString());
          writeJson(res, 429, { error: 'Too Many Requests' });
          return;
        }

        // In stateless mode, build a fresh transport+server per request and tear
        // them down on response close. This matches the SDK's reference example
        // and avoids cross-request leakage.
        let transport: StreamableHTTPServerTransport;
        let mcpServer: McpServer | null = null;
        if (options.stateless) {
          mcpServer = buildServer();
          transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
            enableJsonResponse: true,
          });
          // Register cleanup BEFORE connect(). If connect() throws, the
          // catch below writes a 500 and the response closes immediately,
          // which fires this listener — without it, both transport and
          // server objects (each holding open streams) would leak per
          // failed request and exhaust the process under load.
          const cleanup = () => {
            transport.close().catch(() => {});
            mcpServer?.close().catch(() => {});
          };
          res.on('close', cleanup);
          await mcpServer.connect(transport);
        } else {
          transport = sharedTransport!;
        }

        // Pre-read the body for POST so we can enforce a size limit before the
        // SDK's web-standard layer consumes it. The SDK skips its own JSON parse
        // when `parsedBody` is provided.
        let body: unknown;
        if (method === 'POST') {
          body = await readBody(req);
        }
        await transport.handleRequest(req, res, body);
      } catch (err) {
        // The SDK writes its own response on JSON-RPC errors; only handle the
        // pre-handler cases (body too large, malformed JSON, connect failure)
        // where headers are still uncommitted.
        if (!res.headersSent) {
          const message = err instanceof Error ? err.message : 'Internal error';
          writeJson(res, 500, { error: message });
        }
      }
    })();
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, options.host, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  const address = server.address();
  const boundPort = typeof address === 'object' && address ? address.port : options.port;

  return {
    server,
    port: boundPort,
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
      if (sharedTransport) await sharedTransport.close();
      if (sharedServer) await sharedServer.close();
    },
  };
}
