# MCP client as a parity guard, not the chat agent's tool source

- **Date:** 2026-06-23
- **Status:** Accepted
- **Ticket:** PF-915 (#8825)

## Context

The chat agent (`web/src/lib/ai/spawnforgeAgent.ts`) builds its tool schemas from
`web/src/data/commands.json` — a copy of `mcp-server/manifest/commands.json`. The
two files are kept byte-identical by the file-to-file gate
`apps/docs/scripts/check-manifest-sync.ts`. The web copy exists because of the
Next.js import boundary (production code cannot import from outside `web/`).

PF-915 asked whether adopting the AI SDK MCP client (`@ai-sdk/mcp`,
`createMCPClient`) could retire this dual-maintenance by having the web agent
source its tools directly from the MCP server, whose Streamable HTTP transport
(`mcp-server/src/transport/http.ts`) already serves one tool per command.

## Decision

Add the MCP client as **out-of-band infrastructure and a tool-parity guard**, and
**keep the static `commands.json` import as the chat agent's tool source.** Do not
wire MCP-fetched tools into the chat hot path.

Two reasons make the static manifest the correct hot-path source, not a
limitation to remove:

1. **Execution model.** The chat agent attaches **no execute functions** to its
   tools — tool calls are forwarded to the browser to run against the WASM engine
   (`spawnforgeAgent.ts`). An MCP client's `tools()` return executable tools that
   run against the *server's* `EditorBridge`. Substituting those would silently
   change where commands execute, breaking the browser-forwarding contract.
2. **Hot-path cost.** Sourcing tools from MCP means a network round-trip (and a
   live server dependency) on every chat request. The static JSON import is
   zero-latency and has no runtime failure mode. Trading that for a network hop
   is a regression, not a simplification.

## What we shipped

- `web/src/lib/mcp/client.ts` — env-guarded (`MCP_HTTP_URL` + `MCP_HTTP_TOKEN`)
  `createSpawnforgeMcpClient` / `withMcpClient`. Returns `null` (no-op) when
  unconfigured, so CI/dev/prod are unaffected until the vars are set. Bearer auth
  matches the server's `MCP_HTTP_TOKEN`.
- `web/src/lib/mcp/toolParity.ts` — compares the bundled command set against the
  tools a *live* server actually serves. This catches drift the file-to-file
  `check-manifest-sync.ts` cannot: a deployed server running a different manifest
  version than the web bundle baked in. Runs as a `skipIf`-guarded test when the
  env vars are present; a pure `compareToolSets` is unit-tested without a server.

## Consequences / follow-ups

- The dual-maintenance file remains, still guarded by `check-manifest-sync.ts`;
  the new parity guard adds live-server coverage on top.
- This client is the foundation for genuinely out-of-band MCP uses (resources,
  prompts, admin/automation tooling) that are *not* latency-sensitive and *do*
  want server-side execution.
- A full cutover (deriving the schema surface from MCP at **build time**, so the
  committed copy can be deleted) remains possible but is deferred: it would need a
  build step that runs the server, and buys little over the existing gate.
