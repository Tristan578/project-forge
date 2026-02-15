# Tool Call Handler Registry

This directory contains the refactored tool call handlers, split from the monolithic `executor.ts` (3,942 lines) into a handler registry pattern for maintainability.

## Architecture

```
handlers/
├── types.ts              # Shared types: ToolHandler, ExecutionResult, ToolCallContext
├── helpers.ts            # Shared utilities: buildMaterialFromPartial, mulberry32, etc.
├── transformHandlers.ts  # Entity spawn/delete/transform/selection/undo/redo
├── materialHandlers.ts   # Materials, lighting, shaders, environment, skybox, post-processing
├── queryHandlers.ts      # All read-only query operations (get_* commands)
└── README.md             # This file

executor.ts               # Main entry point with handler registry
executor.legacy.ts        # Original monolithic executor (fallback for unmigrated handlers)
```

## Handler Categories

### transformHandlers.ts (18 handlers)
- Entity lifecycle: `spawn_entity`, `despawn_entity`, `delete_entities`, `duplicate_entity`
- Transforms: `update_transform`, `rename_entity`, `reparent_entity`, `set_visibility`
- Selection: `select_entity`, `select_entities`, `clear_selection`
- Editor controls: `set_gizmo_mode`, `set_coordinate_mode`, `toggle_grid`, `set_snap_settings`
- Camera: `set_camera_preset`, `focus_camera`
- History: `undo`, `redo`

### materialHandlers.ts (12 handlers)
- Materials: `update_material`, `apply_material_preset`
- Shaders: `set_custom_shader`, `remove_custom_shader`, `list_shaders`
- Lighting: `update_light`, `update_ambient_light`
- Environment: `update_environment`, `set_skybox`, `remove_skybox`, `update_skybox`, `set_custom_skybox`
- Post-processing: `update_post_processing`, `get_post_processing`

### queryHandlers.ts (35 handlers)
All read-only `get_*` and `list_*` commands:
- Scene queries: `get_scene_graph`, `get_entity_details`, `get_selection`, `get_scene_name`
- Component queries: `get_physics`, `get_audio`, `get_script`, `get_animation_state`, etc.
- Asset queries: `list_assets`, `list_animations`, `list_script_templates`
- Game queries: `get_game_components`, `list_game_component_types`, `get_game_camera`
- Sprite/2D queries: `get_sprite`, `get_physics2d`, `get_tilemap`, `get_skeleton2d`
- Misc queries: `get_mode`, `get_camera_state`, `get_export_status`, `get_quality_settings`

## Adding New Handlers

1. **Choose the appropriate file** based on the handler's domain.
2. **Add the handler** to the exported object:
   ```typescript
   export const transformHandlers: Record<string, ToolHandler> = {
     my_new_command: async (args, { store }) => {
       // Implementation
       return { success: true, result: { message: 'Done' } };
     },
   };
   ```
3. **Update executor.ts** if adding a new handler file:
   ```typescript
   import { newHandlers } from './handlers/newHandlers';

   const handlerRegistry = {
     ...transformHandlers,
     ...materialHandlers,
     ...queryHandlers,
     ...newHandlers, // Add here
   };
   ```

## Migrating Remaining Handlers

The following handler categories are still in `executor.legacy.ts` and should be migrated:

- **Physics** (~15 handlers): physics, joints, forces, collisions, raycasting
- **Audio** (~25 handlers): audio, buses, effects, reverb, crossfade, layering
- **Animations** (~15 handlers): skeletal animations, clips, blending, state machines
- **Particles** (~8 handlers): particle system operations
- **Procedural** (~10 handlers): CSG, terrain, procedural meshes
- **Game Components** (~10 handlers): game components, cameras, input, scene transitions
- **Scene/Assets** (~30 handlers): export, load, save, assets, prefabs, scenes, quality, templates
- **Sprites/2D** (~30 handlers): sprites, animations, physics2d, tilemaps, skeletons
- **AI Generation** (~12 handlers): AI asset generation (models, textures, audio, skybox)
- **UI Builder** (~15 handlers): UI screen and widget management
- **Compound Actions** (~8 handlers): `describe_scene`, `analyze_gameplay`, `arrange_entities`, etc.
- **Dialogue** (~8 handlers): dialogue tree operations
- **Publishing** (~4 handlers): cloud publishing
- **Scripts** (~6 handlers): script library, visual scripting

Total migrated: **65 handlers**
Total remaining: **~196 handlers**

## Benefits of Registry Pattern

1. **Maintainability**: Each handler file is 100-400 lines instead of 3,942
2. **Discoverability**: Easy to find handlers by category
3. **Type Safety**: Consistent `ToolHandler` signature across all handlers
4. **Testing**: Easier to unit test individual handler modules
5. **Code Ownership**: Clear boundaries for feature teams
6. **Performance**: No impact (same runtime behavior, just reorganized code)

## Usage Pattern

The executor uses a simple registry lookup:

```typescript
export async function executeToolCall(
  toolName: string,
  input: Record<string, unknown>,
  store: EditorState
): Promise<ExecutionResult> {
  const ctx: ToolCallContext = { store };
  const handler = handlerRegistry[toolName];

  if (handler) {
    return await handler(input, ctx);
  }

  // Fallback to legacy executor for unmigrated handlers
  return await legacyExecuteToolCall(toolName, input, store);
}
```

This allows incremental migration without breaking existing functionality.
