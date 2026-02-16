---
applyTo: "mcp-server/**"
---

# MCP Server Instructions

This is a Model Context Protocol server built on the MCP SDK. It exposes 329 engine commands as AI-callable tools and communicates with the web editor via WebSocket.

## Hard Rules

- Every MCP tool must have a complete JSON Schema definition with descriptions for all parameters.
- The WebSocket bridge requires Bearer token auth via `FORGE_WS_TOKEN`. Never add unauthenticated transport endpoints.
- All tool handlers must validate input before forwarding to the editor. Do not pass raw AI output to the WebSocket.
- Use exponential backoff for reconnection (1s base, 30s cap, reset on success). Never use fixed-delay reconnection loops.

## Tool Registration

- Tools are registered in `src/resources/index.ts` with name, description, and input schema.
- Tool names follow the pattern: `forge_<domain>_<action>` (e.g., `forge_scene_spawn_entity`, `forge_material_set_color`).
- Each tool's input schema must match the corresponding Zod schema in the web editor's handler.
- When adding new tools, also add the corresponding handler in `web/src/lib/chat/handlers/`.

## WebSocket Transport

- `src/transport/websocket.ts` manages the connection to the editor's WebSocket server.
- The bridge sends JSON commands and receives JSON responses.
- Connection lifecycle: connect → authenticate → send/receive → reconnect on failure.
- Pending commands are queued during disconnection and replayed on reconnect. Clear the queue if reconnection exceeds 5 minutes.

## Testing

- Framework: vitest. Run: `npx vitest run` from `mcp-server/`.
- Test tool manifest completeness (all tools have schemas, descriptions).
- Test tool search/filtering.
- Mock WebSocket for transport tests. Do not require a running editor.

## Build

- Compile: `npx tsc` (TypeScript strict mode).
- No bundler — runs as a Node.js process.
- Entry point: `src/index.ts`.
