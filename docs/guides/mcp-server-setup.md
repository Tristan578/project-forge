# MCP Server Integration Guide

Connect your AI agent to SpawnForge's MCP server to programmatically create and modify games.

## Prerequisites

- Node.js 18+
- npm or yarn
- A running SpawnForge editor instance at `http://localhost:3000` (the MCP server connects to it via WebSocket)

## Installation

```bash
cd mcp-server
npm install
npm run build
```

## Architecture Overview

The MCP server uses **stdio transport** to communicate with AI clients (Claude Desktop, Claude Code, Cursor). Separately, it maintains an outbound WebSocket connection to the running SpawnForge editor to relay commands and receive scene state.

```
AI Client (Claude Desktop / Claude Code)
    ↕  stdio (MCP protocol)
MCP Server (mcp-server/dist/index.js)
    ↕  WebSocket (ws://localhost:3001/api/mcp/ws)
SpawnForge Editor (Next.js dev server)
```

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

### Connecting to a Non-Default Editor URL

By default the server connects to `ws://localhost:3001/api/mcp/ws`. Override this with the `FORGE_EDITOR_WS_URL` environment variable:

```bash
FORGE_EDITOR_WS_URL=ws://localhost:3001/api/mcp/ws node dist/index.js
```

## Connecting from Claude Desktop

Add this to your Claude Desktop MCP configuration (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "spawnforge": {
      "command": "node",
      "args": ["/absolute/path/to/project-forge/mcp-server/dist/index.js"],
      "env": {
        "FORGE_EDITOR_WS_URL": "ws://localhost:3001/api/mcp/ws"
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
| `set_ambient_light` | Set scene ambient light color and intensity |
| `set_environment` | Configure fog, clear color |
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
| `update_audio` | Attach an audio clip to an entity with volume, loop, and spatial settings |
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
| `update_script` | Attach a TypeScript script to an entity |
| `remove_script` | Remove a script from an entity |

**2D / Tilemap**

| Tool | Description |
|------|-------------|
| `set_project_type` | Switch between 2D and 3D project modes |
| `update_sprite` | Configure sprite data and sorting layer |
| `update_tilemap` | Edit tilemap layer data |

**Compound Actions**

Eight high-level tools that chain multiple commands in sequence:

| Tool | Description |
|------|-------------|
| `create_scene` | Build a complete scene from a description |
| `setup_character` | Configure a character entity with physics and input |
| `configure_mechanics` | Set up game mechanics (health, collectibles, etc.) |
| `arrange_entities` | Place and organise multiple entities |
| `apply_style` | Apply a visual style to the whole scene |
| `describe_scene` | Return a natural-language description of the current scene |
| `analyze_gameplay` | Evaluate gameplay balance and configuration |

Use `list_doc_topics` or `search_docs` to discover the full set of 322 commands by category.

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

**"Not connected to the editor"** — Start the SpawnForge dev server (`cd web && npm run dev`) and wait for it to be ready at `http://localhost:3000`. The MCP server will reconnect automatically within 5 seconds.

**Tool calls return errors but the editor is running** — Check that `FORGE_EDITOR_WS_URL` points to the correct WebSocket endpoint. The default is `ws://localhost:3001/api/mcp/ws`.

**`node dist/index.js` fails with "Cannot find module"** — Run `npm run build` in the `mcp-server` directory first to compile TypeScript to JavaScript.

**Documentation tools return empty results** — Ensure the `docs/` directory exists relative to the `mcp-server` package. The doc loader resolves paths relative to the installed package location.

## Command Reference

For a complete list of all 322 commands with full parameter schemas, see:

- [Command Reference](../reference/commands.md)
- Use the `search_docs` tool to find commands by keyword
- Use `list_doc_topics` to browse all documentation categories

## Related Guides

- [AI Workflow](./ai-workflow.md) — using AI to build games with natural language
- [Build an FPS Game](./build-fps-game.md) — end-to-end game tutorial
- [Scripting](../features/scripting.md) — TypeScript game logic
