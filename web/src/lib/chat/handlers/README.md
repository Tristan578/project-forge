# Tool Call Handler Registry

Each file in this directory handles a domain of Claude tool calls. The registry is merged in `executor.ts` and dispatched by tool name.

## Architecture

```
handlers/
├── types.ts                    # ToolHandler, ExecutionResult, ToolCallContext, shared Zod schemas
├── helpers.ts                  # buildMaterialFromPartial, mulberry32, entity lookup utils
├── transformHandlers.ts        # Spawn, delete, transform, selection, undo/redo, camera, gizmo
├── materialHandlers.ts         # Materials, lighting, environment, skybox, post-processing
├── queryHandlers.ts            # All read-only get_* / list_* commands
├── editModeHandlers.ts         # Edit mode (vertex/edge/face), extrude, subdivide
├── audioHandlers.ts            # Audio components, buses, effects, reverb zones
├── audioLegacyHandlers.ts      # Adaptive music, crossfade, stem layering
├── securityHandlers.ts         # Content validation, injection detection
├── exportHandlers.ts           # Game export (ZIP, PWA, embed), cloud publishing
├── shaderHandlers.ts           # Shader effects, custom WGSL, shader graph
├── performanceHandlers.ts      # LOD, quality presets, performance budget
├── generationHandlers.ts       # AI asset generation (3D models, textures, audio, music)
├── handlers2d.ts               # Sprites, sprite animation, tilemaps, 2D physics, skeleton 2D
├── entityHandlers.ts           # Entity metadata, custom properties, prefabs
├── sceneManagementHandlers.ts  # Scene CRUD, multi-scene, scene transitions
├── uiBuilderHandlers.ts        # In-game UI screens and widgets
├── dialogueHandlers.ts         # Dialogue tree nodes, branches, NPC conversations
├── scriptLibraryHandlers.ts    # Script save/load/import/export library
├── physicsJointHandlers.ts     # 3D physics, joints, forces, raycasting, CSG, terrain
├── animationParticleHandlers.ts # Skeletal animation, animation clips, particles
├── gameplayHandlers.ts         # Game components, game cameras, input bindings
├── assetHandlers.ts            # Asset import, GLTF, textures, prefab instantiation
├── pixelArtHandlers.ts         # Pixel art / sprite sheet AI generation
├── compoundHandlers.ts         # Multi-step compound actions (create_scene, setup_character, etc.)
├── leaderboardHandlers.ts      # Leaderboard and score tracking
├── ideaHandlers.ts             # Game idea generation and brainstorming
├── worldHandlers.ts            # World generation and procedural content
├── localizationHandlers.ts     # Localization strings and language support
├── economyHandlers.ts          # In-game economy and shop systems
└── cutsceneHandlers.ts         # Cutscene sequencing and camera paths

executor.ts                     # Merges all registries; unknown tools return an error
```

## Adding New Handlers

1. Add the handler to the appropriate domain file (or create a new one for a new domain).
2. Export it as part of the file's `Record<string, ToolHandler>`.
3. If you created a new file, import and spread it in `executor.ts`.

```typescript
// In transformHandlers.ts
export const transformHandlers: Record<string, ToolHandler> = {
  my_new_command: async (args, { store }) => {
    const p = parseArgs(z.object({ entityId: zEntityId }), args);
    if (p.error) return p.error;
    store.doSomething(p.data.entityId);
    return { success: true, result: { message: 'Done' } };
  },
};
```

Every new command must also be added to `mcp-server/manifest/commands.json` and `web/src/data/commands.json` (keep in sync) with `visibility: 'public'` or `visibility: 'internal'`.

## Usage Pattern

`executeToolCall` does a single registry lookup:

```typescript
export async function executeToolCall(toolName, input, store) {
  const handler = handlerRegistry[toolName];
  if (handler) return await handler(input, ctx);
  return { success: false, error: `Unknown tool: ${toolName}` };
}
```

Unknown tool names return an error rather than throwing — callers must check `result.success`.
