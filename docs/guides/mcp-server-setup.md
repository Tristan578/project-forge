# MCP Server Integration Guide

Connect your AI agent to SpawnForge's MCP server to programmatically create and modify games.

## Prerequisites

- Node.js 24
- npm or yarn
- A running SpawnForge editor (`cd web && npm run dev` → `http://spawnforge.localhost:1355`; `/dev` bypasses auth locally) and the loopback relay (`cd mcp-server && MCP_RELAY_TOKEN=<secret> npm run relay`)

## Installation

```bash
cd mcp-server
npm install
npm run build
```

## Architecture Overview

The MCP server uses **stdio transport** to communicate with AI clients (Claude Desktop, Claude Code, Cursor). Separately, it dials a small **loopback relay**; the editor tab attaches to the same relay when opened with `?mcp=<token>`. Every command handler runs inside that tab (the WASM engine and the editor stores live there), which is why the bridge terminates in a browser and not in the Next.js server — see the ADR in `docs/decisions/2026-09-02-mcp-editor-bridge-relay.md`.

```
AI Client (Claude Desktop / Claude Code)
    ↕  stdio (MCP protocol)
MCP Server (mcp-server/dist/index.js)            role=agent
    ↕  WebSocket ws://127.0.0.1:3001/api/mcp/ws?token=…
Loopback relay (cd mcp-server && npm run relay)
    ↕  WebSocket, same token                      role=editor
SpawnForge editor tab  (…/dev?mcp=<token>)
```

### What the relay enforces at the handshake

A WebSocket handshake is exempt from the same-origin policy, so any page you
visit while the relay is running is also a loopback peer. The relay therefore
checks five things before a socket exists at all; a failure is answered with
**HTTP 403** at the upgrade, so nothing is ever forwarded:

1. **Loopback peer** — the connecting socket's address is `127.0.0.1` or `::1`.
2. **Loopback `Host` header** — blocks DNS rebinding, where a hostile name
   resolves to `127.0.0.1` and the browser dials the relay for the attacker.
3. **`role=agent` must send no `Origin`** — browsers always send one, the Node
   client never does. A page cannot forge its absence, so a web origin cannot
   impersonate the MCP server.
4. **`role=editor` must send an allowlisted `Origin`** — `localhost`,
   `127.0.0.1`, `[::1]`, `spawnforge.localhost` and its subdomains (worktrees).
   Add others with `MCP_RELAY_EDITOR_ORIGINS` (comma-separated).
5. **A shared token of at least 32 characters**, compared in constant time. The
   relay refuses to start without one, or with a shorter one. Five failed
   attempts lock the peer out for 60 seconds.

After the handshake the relay keeps **one editor at a time** (a second is closed
with `4409`), and closes an unknown `role` with `4400`.

The editor side is opt-in per tab (the `?mcp=` parameter), is off in production
builds unless `NEXT_PUBLIC_MCP_BRIDGE=true`, and asks for your consent in the tab
before it attaches — a small dialog naming what the agent can and cannot do.
Once attached, a persistent indicator names each command that ran or was
refused, with a one-click **Detach**. The bridge runs an **allowlist**: 293 of
the 351 commands are permitted by name, and anything not enumerated — including
any command added to the manifest later — is refused. Scripting is denied
outright: `create_script` source reaches `Function(...)` in the editor (see SEC-2
in the root `CLAUDE.md`), as are commands that spend generation tokens, export,
publish, or touch security/economy.

The MCP server starts even when the editor is not running — tool calls will return an error until the editor comes online. It auto-reconnects every 5 seconds.

## Starting the MCP Server

The server communicates via **stdin/stdout** using the MCP protocol. Start it directly:

```bash
cd mcp-server
node dist/index.js
```

Or during development (without a build step):

```bash
cd mcp-server
npm run dev
```

### Starting the relay and the editor

```bash
cd mcp-server
MCP_RELAY_TOKEN=$(openssl rand -hex 16) npm run relay      # prints the URLs it serves
# open http://spawnforge.localhost:1355/dev?mcp=<the same token> in the browser
```

The server dials `ws://127.0.0.1:3001/api/mcp/ws` by default; `FORGE_EDITOR_WS_URL` overrides the base and `MCP_RELAY_PORT` moves the relay. `MCP_RELAY_TOKEN` must be the same value on the relay, the editor URL and the server.

## Connecting from Claude Desktop

Add this to your Claude Desktop MCP configuration (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "spawnforge": {
      "command": "node",
      "args": ["/absolute/path/to/project-forge/mcp-server/dist/index.js"],
      "env": {
        "MCP_RELAY_TOKEN": "<the token the relay was started with>"
      }
    }
  }
}
```

Replace `/absolute/path/to/project-forge` with the actual path on your system.

## Connecting from Claude Code

Add the MCP server to your Claude Code project configuration (`.claude/settings.json`):

```json
{
  "mcpServers": {
    "spawnforge": {
      "command": "node",
      "args": ["/absolute/path/to/project-forge/mcp-server/dist/index.js"]
    }
  }
}
```

## Available Tools

### Documentation Tools

These tools work without an editor connection — they operate on the local docs directory.

| Tool | Description |
|------|-------------|
| `search_docs` | Search SpawnForge documentation using BM25 ranking. Returns ranked results with snippets. |
| `get_doc` | Retrieve a full documentation page by its path (e.g., `"features/physics"`). |
| `list_doc_topics` | List all available documentation topics with titles and tags. |

**Example — search docs:**

```json
{
  "tool": "search_docs",
  "arguments": { "query": "how to add physics to an entity", "maxResults": 5 }
}
```

**Example — read a doc page:**

```json
{
  "tool": "get_doc",
  "arguments": { "path": "features/physics" }
}
```

### Game Creation Commands (329 total)

These tools require an active editor connection. Commands are organised into 41 categories.

**Scene Management**

| Tool | Description |
|------|-------------|
| `spawn_entity` | Create a new entity (cube, sphere, plane, cylinder, cone, torus, capsule, point_light, directional_light, spot_light) |
| `delete_entities` | Remove one or more entities by ID |
| `duplicate_entity` | Copy an entity with an offset position |
| `rename_entity` | Change an entity's display name |
| `reparent_entity` | Move an entity to a new parent in the hierarchy |
| `update_transform` | Set position, rotation (degrees), and/or scale |
| `select_entity` | Select an entity for inspection |
| `export_scene` / `load_scene` | Save and load `.forge` project files |

**Materials and Lighting**

| Tool | Description |
|------|-------------|
| `update_material` | Set PBR properties: color, metallic, roughness, emissive, textures |
| `update_light` | Configure point/directional/spot light properties |
| `update_ambient_light` | Set scene ambient light color and intensity |
| `update_environment` | Configure fog, clear color |
| `set_skybox` | Apply a skybox preset |

**Physics**

| Tool | Description |
|------|-------------|
| `update_physics` | Set body type (static/dynamic/kinematic), collider shape, mass, friction, restitution |
| `create_joint` | Connect two entities with a physics joint (fixed, revolute, prismatic, etc.) |
| `apply_force` | Apply an impulse or continuous force during play mode |

**Audio**

| Tool | Description |
|------|-------------|
| `set_audio` | Attach an audio clip to an entity with volume, loop, and spatial settings |
| `create_audio_bus` | Set up an audio routing bus |

**Animation**

| Tool | Description |
|------|-------------|
| `play_animation` | Start or stop a GLTF skeletal animation |
| `set_animation_speed` | Control playback speed |
| `create_animation_clip` | Create a keyframe animation clip for an entity |

**Scripting**

| Tool | Description |
|------|-------------|
| `set_script` | Set or update the TypeScript source on an entity |
| `remove_script` | Remove a script from an entity |

**2D / Tilemap**

| Tool | Description |
|------|-------------|
| `set_project_type` | Switch between 2D and 3D project modes |
| `create_sprite` | Create a 2D sprite entity with an optional texture and position |
| `set_sprite_texture` | Assign or change a sprite's texture |
| `set_sprite_sorting` | Set a sprite's sorting layer and order |
| `create_tilemap` | Create a tilemap entity backed by an imported tileset |
| `set_tile` | Set a single tile on one tilemap layer |
| `fill_tiles` | Fill an inclusive rectangular range of one layer with a single tile |
| `clear_tiles` | Erase tiles from one layer; omit the bounds to clear the whole layer |

**Compound Actions**

Nine high-level tools that chain multiple commands in sequence:

| Tool | Description |
|------|-------------|
| `create_scene_from_description` | Build a complete scene from a description |
| `setup_character` | Configure a character entity with physics and input |
| `configure_game_mechanics` | Set up game mechanics (health, collectibles, etc.) |
| `arrange_entities` | Place and organise multiple entities |
| `apply_style` | Apply a visual style to the whole scene |
| `describe_scene` | Return a natural-language description of the current scene |
| `analyze_gameplay` | Evaluate gameplay balance and configuration |
| `create_level_layout` | Generate a level layout with ground, walls, obstacles and spawn points |
| `setup_game_from_description` | Scaffold a complete, playable game from a plain-text description |

Use `list_doc_topics` or `search_docs` to discover the full set of 351 commands by category.

## Available Resources

Resources expose live editor state and can be read at any time without a tool call:

| Resource URI | Description |
|-------------|-------------|
| `forge://scene/graph` | Current scene entity hierarchy (JSON) |
| `forge://scene/selection` | Currently selected entity IDs (JSON) |
| `forge://project/info` | Current project name and metadata (JSON) |
| `forge://docs/index` | List of all documentation topics (JSON) |
| `forge://docs/{path}` | Content of a specific documentation page (Markdown) |

Scene graph and selection resources are cached from editor push events. When the cache is stale the server queries the editor on demand.

## Example Workflows

### Create a Simple Physics Scene

```jsonc
// 1. Spawn a ground plane
{ "tool": "spawn_entity", "arguments": { "entityType": "plane", "name": "Ground" } }

// 2. Spawn a cube above it — note the returned entityId
{ "tool": "spawn_entity", "arguments": { "entityType": "cube", "name": "Box", "position": [0, 3, 0] } }

// 3. Give the ground a static collider
{ "tool": "update_physics", "arguments": { "entityId": "<ground-id>", "bodyType": "static", "colliderType": "cuboid" } }

// 4. Give the cube a dynamic collider so it falls
{ "tool": "update_physics", "arguments": { "entityId": "<box-id>", "bodyType": "dynamic", "colliderType": "cuboid" } }

// 5. Set the cube material to a blue PBR colour
{ "tool": "update_material", "arguments": { "entityId": "<box-id>", "color": [0.2, 0.4, 0.9] } }

// 6. Add a light so the scene is visible
{ "tool": "spawn_entity", "arguments": { "entityType": "directional_light", "name": "Sun", "position": [5, 10, 5] } }
```

### Query the Scene Before Modifying It

Always read the scene graph first so you have accurate entity IDs:

```jsonc
// Read the resource — no tool call needed
// Resource URI: forge://scene/graph

// Or use the query tool explicitly
{ "tool": "query", "arguments": { "type": "scene_graph" } }

// Then search docs if unsure about a parameter
{ "tool": "search_docs", "arguments": { "query": "collider types" } }
```

### Use a Compound Action

Compound actions chain multiple commands for you:

```jsonc
{
  "tool": "setup_character",
  "arguments": {
    "entityId": "<player-id>",
    "controlScheme": "platformer"
  }
}
```

## Behaviour and Limits

| Property | Value |
|----------|-------|
| Command timeout | 30 seconds |
| Auto-reconnect interval | 5 seconds |
| Transport | stdio (MCP protocol) |
| Editor connection | Outbound WebSocket to `FORGE_EDITOR_WS_URL` |

If a command times out, the error message will name the specific command. Retry once the editor is responsive.

## Security Notes

- The MCP server connects to a local editor instance only — no remote network access is made on your behalf.
- Commands affect only the currently open project in the connected editor.
- No credentials, API keys, or user data are transmitted through MCP tools.
- The server does not expose any project management, billing, or account endpoints.

## Troubleshooting

**"Not connected to the MCP relay"** — start the relay (`cd mcp-server && MCP_RELAY_TOKEN=<secret> npm run relay`) with the same token the server was given. The server retries with backoff a bounded number of times and then stops; restart it after the relay is up.

**"No editor is attached to the MCP relay"** — the relay is up but no tab has attached. Open the editor with `?mcp=<token>` (`http://spawnforge.localhost:1355/dev?mcp=<token>` locally), then **approve the consent prompt in the tab** — the bridge does not attach until you do. Only one tab can be attached at a time; a second one is refused.

**The relay exits immediately with "MCP_RELAY_TOKEN is required" or "…is N characters; at least 32 are required"** — the token is missing or too short. Generate one with `openssl rand -hex 32`.

**The tab reads "The relay rejected this token" (close code `4401`)** — the `?mcp=` value does not match the relay's `MCP_RELAY_TOKEN`. The tab does not retry this one. Five wrong attempts lock that peer out for 60 seconds, so fix the token and wait a minute before reloading.

**The tab reads "Gave up reconnecting after 5 attempts"** — the relay kept closing the socket. The usual cause is close code `4409`, "an editor is already attached": another tab holds the editor slot. Detach it with the indicator's **Detach** button, or close it, then reload this one. The relay logs the close code it sent.

**The connection fails with HTTP 403 before any WebSocket opens** — the handshake was rejected: a non-loopback peer, a `Host` header that is not loopback, an `Origin` on the agent connection, or an editor `Origin` that is not allowlisted. The relay logs which one. If you serve the editor from an origin other than `localhost`, `127.0.0.1` or `*.spawnforge.localhost`, add it to `MCP_RELAY_EDITOR_ORIGINS`.

**The tab reads "The relay refused this tab (close code 4400)"** — the URL carried a `role` other than `editor` or `agent`. Nothing retries; fix the URL.

**A command is refused by the bridge** — the editor side runs an allowlist, not a blocklist: only enumerated categories are permitted, so a newly added command is refused until it is classified. Scripting (`create_script` and friends) is denied permanently — its source reaches `Function(...)` in the tab — as are commands that spend generation tokens, export, publish, or touch security/economy. That is by design; run those from the editor itself.

**`node dist/index.js` fails with "Cannot find module"** — Run `npm run build` in the `mcp-server` directory first to compile TypeScript to JavaScript.

**Documentation tools return empty results** — Ensure the `docs/` directory exists relative to the `mcp-server` package. The doc loader resolves paths relative to the installed package location.

## Command Reference

For a complete list of all 351 commands with full parameter schemas, see:

- [Command Reference](../reference/commands.md)
- Use the `search_docs` tool to find commands by keyword
- Use `list_doc_topics` to browse all documentation categories

## Related Guides

- [AI Workflow](./ai-workflow.md) — using AI to build games with natural language
- [Build an FPS Game](./build-fps-game.md) — end-to-end game tutorial
- [Scripting](../features/scripting.md) — TypeScript game logic
