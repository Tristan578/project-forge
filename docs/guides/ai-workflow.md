# AI Workflow

Use AI (MCP) to build games faster with natural language commands.

## Overview
Project Forge exposes all editor capabilities as MCP (Model Context Protocol) tools. AI assistants like Claude can use these tools to create scenes, modify entities, configure physics, write scripts, and more — all from natural language instructions.

## Getting Started with MCP

### Setup
The MCP server runs alongside the editor:
1. Start the editor: `cd web && npm run dev`
2. The MCP server connects via WebSocket to the running editor
3. Configure your AI client (Claude Desktop, Claude Code) to use the Project Forge MCP server

### Available Tools
The MCP server provides **115 tools** covering:
- **Scene** — spawn, delete, duplicate, rename, reparent, select entities
- **Transforms** — position, rotate, scale, snap settings
- **Materials** — PBR properties, textures, presets, extended properties
- **Lighting** — light properties, ambient light, environment
- **Physics** — rigid bodies, colliders, forces, gravity
- **Audio** — playback, mixer, buses, effects, layering
- **Scripting** — set/remove scripts, templates
- **Particles** — presets, custom parameters, playback
- **Animation** — play, blend, crossfade, speed
- **Terrain** — spawn, configure noise, sculpt
- **Mesh** — CSG booleans, extrude, lathe, array, combine
- **Export** — game export
- **Query** — read scene state, entity info, selection
- **Documentation** — search and read these docs

### Resources
MCP resources provide live state without tool calls:
- `forge://scene/graph` — current scene hierarchy
- `forge://scene/selection` — selected entities
- `forge://project/info` — project metadata
- `forge://docs/index` — documentation index
- `forge://docs/{path}` — specific documentation pages

## Example Workflows

### "Create a solar system"
AI approach:
1. Query scene to check current state
2. Spawn a sphere for the sun, apply emissive yellow material
3. Spawn smaller spheres for planets at increasing distances
4. Add point light to the sun
5. Add rotating scripts to each planet
6. Set dark background with bloom post-processing

### "Make a physics playground"
AI approach:
1. Set up a large ground plane with static physics
2. Spawn various shapes (cubes, spheres, cylinders)
3. Add dynamic physics to all shapes
4. Create a ramp using rotated planes
5. Set different materials (bouncy rubber, slippery ice)
6. Add gravity and test in play mode

### "Build an atmospheric forest scene"
AI approach:
1. Spawn terrain with high-frequency noise
2. Import tree models (glTF)
3. Array trees across the terrain
4. Add fog with green tint
5. Set ambient light low, add directional "moonlight"
6. Add particle effects (dust, fireflies)
7. Add ambient audio (forest sounds)

## Tips for AI Workflows
- **Be specific** — "make the cube red and shiny" is better than "change the cube"
- **Work incrementally** — build scenes step by step, testing as you go
- **Use presets** — material presets, input presets, and particle presets save time
- **Query first** — have the AI read the scene graph before making changes
- **Combine tools** — AI can chain multiple commands in sequence for complex operations

## Documentation Access
AI assistants can search and read these docs via MCP:
```json
{"tool": "search_docs", "params": {"query": "how to add physics to an entity"}}
{"tool": "get_doc", "params": {"path": "features/physics"}}
{"tool": "list_doc_topics", "params": {}}
```

## Related
- [Scripting](../features/scripting.md) — AI can write game scripts
- [Scene Management](../features/scene-management.md) — scene operations
