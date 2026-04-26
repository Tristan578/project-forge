# SpawnForge MCP Server

Exposes 350 SpawnForge editor commands as MCP tools over either **stdio** (local
subprocess) or **Streamable HTTP** (remote / browser-based hosts).

The server itself does not execute commands — it forwards JSON-RPC messages to
the editor over a WebSocket bridge (`FORGE_EDITOR_WS_URL`, default
`ws://localhost:3001/api/mcp/ws`). Tools will return errors until the editor is
running.

## Quick start

### stdio (default) — for Claude Desktop, local agents

```bash
npm run build
node dist/index.js
```

The MCP spec for stdio uses line-delimited JSON-RPC over stdin/stdout. No
configuration needed beyond the built artifact.

### Streamable HTTP — for remote / browser hosts

```bash
export MCP_TRANSPORT=http
export MCP_HTTP_TOKEN=$(openssl rand -hex 32)
export MCP_HTTP_PORT=3030          # default
export MCP_HTTP_HOST=0.0.0.0       # default
export MCP_HTTP_STATELESS=1        # optional: stateless mode, JSON responses only
node dist/index.js
```

The server refuses to start if `MCP_HTTP_TOKEN` is empty.

## HTTP endpoints

| Method   | Path     | Auth                        | Purpose                                  |
|----------|----------|-----------------------------|------------------------------------------|
| `GET`    | `/health`| none                        | Liveness probe + server metadata         |
| `POST`   | `/mcp`   | `Authorization: Bearer …`   | JSON-RPC requests (`tools/list`, …)      |
| `GET`    | `/mcp`   | `Authorization: Bearer …`   | Standalone server-to-client SSE channel  |
| `DELETE` | `/mcp`   | `Authorization: Bearer …`   | Close a session (stateful mode only)     |

### Example

```bash
TOKEN=…  # the value of MCP_HTTP_TOKEN

# Health (no auth)
curl http://localhost:3030/health

# Initialize (stateless mode)
curl -X POST http://localhost:3030/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc":"2.0","id":1,"method":"initialize",
    "params":{"protocolVersion":"2025-06-18","capabilities":{},
              "clientInfo":{"name":"curl","version":"0"}}
  }'

# List tools
curl -X POST http://localhost:3030/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
```

## Session models

- **Stateful** (default): one transport+server pair handles every request. The
  SDK assigns a session ID on `initialize` and clients must include it on every
  follow-up request as the `Mcp-Session-Id` header.
- **Stateless** (`MCP_HTTP_STATELESS=1`): a fresh transport+server is built per
  request and torn down on response close. JSON-only responses, no sessions.
  This matches the SDK's reference example and is the only safe way to handle
  concurrent stateless clients.

## Auth

Bearer token via the `Authorization` header. The server compares against
`MCP_HTTP_TOKEN` in constant time (`timingSafeEqual`). The `/health` endpoint is
intentionally unauthenticated so load balancers and uptime probes can reach it
without a token.

## Rate limiting

Per-IP, **30 requests / 5 minutes**, applied after auth.

When `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` are present, the
server uses an Upstash sliding-window limiter (the same backend the web app
uses for public routes). Otherwise it falls back to an in-memory limiter
suitable only for single-instance deployments. Redis errors fail open.

The first hop of `X-Forwarded-For` is honoured if present, falling back to the
TCP remote address.

## Deployment notes

- Behind a reverse proxy, set `X-Forwarded-For` so per-IP limits work.
- For multi-instance deployments, the Upstash backend is required — the
  in-memory limiter only sees its own process.
- The bare `node dist/index.js` works on any container host. A Vercel function
  wrapper for `mcp.spawnforge.ai` is tracked separately (see issue #8497
  acceptance criteria).

## Environment variables

| Variable                       | Default                              | Required when               |
|--------------------------------|--------------------------------------|-----------------------------|
| `MCP_TRANSPORT`                | `stdio`                              | always                      |
| `FORGE_EDITOR_WS_URL`          | `ws://localhost:3001/api/mcp/ws`     | always                      |
| `MCP_HTTP_TOKEN`               | (none — server refuses to start)     | `MCP_TRANSPORT=http`        |
| `MCP_HTTP_PORT`                | `3030`                               | `MCP_TRANSPORT=http`        |
| `MCP_HTTP_HOST`                | `0.0.0.0`                            | `MCP_TRANSPORT=http`        |
| `MCP_HTTP_STATELESS`           | unset (stateful)                     | optional                    |
| `UPSTASH_REDIS_REST_URL`       | (in-memory limiter)                  | optional                    |
| `UPSTASH_REDIS_REST_TOKEN`     | (in-memory limiter)                  | optional                    |
