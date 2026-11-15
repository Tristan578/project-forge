# ADR: the MCP server reaches the editor through a local loopback relay

**Status:** proposed (drafted by the agent for #9293; the owner decides)
**Date:** 2026-09-02
**Ticket:** #9293

## Context

`mcp-server` exposes all 351 manifest commands as MCP tools, and its
`EditorBridge` dials `ws://localhost:3001/api/mcp/ws` to execute them. That
route has never existed in any branch: every tool call from Claude Desktop,
Claude Code or Cursor has returned "Not connected to the editor" since the
server shipped, and the client retried the dead URL every five seconds forever.

This is an architecture decision, not a stub:

- The 351 command handlers run **in the browser** — `web/src/lib/chat/executor.ts`
  dispatches into the Zustand `editorStore` and the WASM engine. Nothing
  server-side can execute a command.
- Vercel Functions cannot hold an inbound WebSocket upgrade, and `web/` has no
  custom Next server. A route under `web/src/app/api/mcp/ws` cannot be a
  WebSocket endpoint on the production host.
- So any bridge must terminate in a live browser tab, and something has to sit
  between the MCP subprocess and that tab.

## Options

**A. Local-only relay (this ADR's recommendation).** A tiny WebSocket relay
inside `mcp-server/` (`npm run relay`), bound to `127.0.0.1:3001`, path
`/api/mcp/ws`, shared token. The editor tab attaches as `role=editor` (opt-in,
per session, via `?mcp=<token>` on the editor URL — never on by default and
never in a production build without `NEXT_PUBLIC_MCP_BRIDGE=true`); the MCP
server attaches as `role=agent`. Commands are forwarded to the editor, results
and scene pushes back. One editor at a time; loopback only; no cloud
components; no new secrets in Vercel. Cost: ~16h. Serves the actual users of
the feature today — a developer with Claude Desktop and the editor on one
machine.

**B. Hosted relay (Cloudflare Durable Objects).** Same protocol, but the relay
runs at `mcp.spawnforge.ai` with a DO per editor session and the existing
`apiKeys` table as the credential. Multi-machine and multi-user. Needs
owner-only Cloudflare provisioning (DO namespace, plan), a key-verification
middleware that does not exist (`apiKeys.keyHash` is read by nothing), and a
security review of exposing 351 editor commands behind a bearer key. ~40h+.

**C. Declare it unsupported.** Remove the WebSocket bridge, the dead default
URL and every doc claim; keep the HTTP transport and the docs/search tools;
close the Creator+ "API keys for MCP clients" surface that authenticates
nothing. ~1.5h.

## Decision (recommended)

Ship **A** now, keep **B** as the follow-on if hosted use is ever wanted, and
do the honest half of **C** regardless: the docs stop asserting a route that
does not exist, the client stops retrying a dead URL forever, and the paid
API-key surface is spun out to its own ticket (wire it or remove it — it must
not stay as a billed no-op).

The relay lives inside `mcp-server/` so `ci.yml`'s `needs-mcp` path filter
covers it without touching the byte-pinned workflow blocks.

## Consequences

- The MCP server works for its actual audience with two commands: `npm run
  relay` and opening the editor with `?mcp=<token>`.
- The default `FORGE_EDITOR_WS_URL` becomes the relay's real address, so a
  stock install no longer points at nothing.
- The editor-side bridge is default-off and runs a true **allowlist**: 293 of
  the 351 manifest commands are permitted by enumerated category, and anything
  unnamed — including a category added to the manifest later — is refused. The
  first draft was a deny-list that permitted 308 commands including
  `create_script`, whose source reaches `Function(...)` in the tab (SEC-2), so
  the direction was inverted to fail closed. Scripting, generation, export,
  publish and security/economy categories are named as denied with reasons.
- Attaching requires an explicit consent prompt in the tab, an attached tab
  carries a persistent indicator naming each command that ran or was refused,
  and Detach is one click. A remote agent mutating the live scene must not be
  indistinguishable from ordinary editing.
- The relay's loopback binding is not by itself a boundary: a WebSocket
  handshake is exempt from the same-origin policy, so any page the user visits
  is also a loopback peer. The handshake therefore requires a loopback peer and
  `Host`, no `Origin` on `role=agent`, an allowlisted `Origin` on `role=editor`,
  and a ≥32-character token compared in constant time with a five-failure
  lockout. Rejections are HTTP 403 at the upgrade, before a socket exists.
- Multi-machine setups are explicitly out of scope until B.
- The in-process relay integration test in `mcp-server` is the proof; there is
  no Playwright path that can drive a tab, a relay and a stdio client together.
