# Handler Registry Reference

How MCP command handlers are registered and dispatched in `web/src/lib/chat/`.

## Architecture

```
useChat (AI SDK)
  → /api/chat route handler
    → executor.ts: handleToolCall(toolName, args, context)
      → handler registry lookup
        → domain handler file (e.g., materialHandlers.ts)
          → parseArgs() validation
            → dispatchCommand() → WASM handle_command()
```

## executor.ts — Handler Registry

`web/src/lib/chat/executor.ts` contains the central handler registry. Each entry maps
a command name to its async handler function:

```ts
// web/src/lib/chat/executor.ts (simplified)
import { transformHandlers } from './handlers/transformHandlers';
import { materialHandlers } from './handlers/materialHandlers';
// ... 29 domain imports

const registry: Record<string, ToolHandler> = {
  ...transformHandlers,
  ...materialHandlers,
  // ... spread all domain handler maps
};

export async function handleToolCall(
  name: string,
  args: Record<string, unknown>,
  context: HandlerContext,
): Promise<ExecutionResult> {
  const handler = registry[name];
  if (!handler) {
    return { success: false, error: `Unknown command: ${name}` };
  }
  return handler(args, context);
}
```

## Domain Handler Files (29 files in web/src/lib/chat/handlers/)

| File | Commands |
|------|---------|
| `transformHandlers.ts` | spawn_entity, delete_entity, move_entity, rotate_entity, scale_entity, rename_entity, duplicate_entity |
| `materialHandlers.ts` | set_material, set_material_preset, set_texture, set_shader |
| `entityHandlers.ts` | select_entity, get_entity, list_entities, reparent_entity |
| `physicsHandlers.ts` | set_physics, set_joint, apply_force, set_collider |
| `audioHandlers.ts` | set_audio, set_audio_bus, set_reverb_zone |
| `animationHandlers.ts` | play_animation, set_animation_speed, set_animation_loop |
| `spriteHandlers.ts` | set_sprite, set_sprite_animation, set_skeleton_2d |
| `shaderHandlers.ts` | apply_shader, set_custom_shader |
| `sceneHandlers.ts` | new_scene, load_scene, export_scene, import_gltf |
| `scriptHandlers.ts` | set_script, set_input_binding |
| `queryHandlers.ts` | query_entity, query_scene, query_physics |
| `exportHandlers.ts` | export_game, export_web, export_mobile |
| `assetHandlers.ts` | upload_asset, generate_texture, generate_sprite |
| `compoundHandlers.ts` | create_scene, setup_character, create_platform |
| `generationHandlers.ts` | generate_music, generate_sound, generate_skybox |
| `gameplayHandlers.ts` | set_game_component, set_game_camera |
| `economyHandlers.ts` | set_economy, set_shop, set_currency |
| `dialogueHandlers.ts` | create_dialogue, add_dialogue_node, set_dialogue_condition |
| `cutsceneHandlers.ts` | create_cutscene, add_cutscene_keyframe |
| `localizationHandlers.ts` | set_locale, add_translation |
| `ideaHandlers.ts` | suggest_game_idea, suggest_mechanic |
| `worldHandlers.ts` | generate_world, generate_terrain |
| `uiBuilderHandlers.ts` | add_ui_widget, set_ui_layout |
| `pixelArtHandlers.ts` | set_pixel_art_camera, set_tilemap |
| `editModeHandlers.ts` | set_edit_mode, toggle_debug |
| `performanceHandlers.ts` | set_lod, set_quality |
| `securityHandlers.ts` | (internal system commands) |
| `leaderboardHandlers.ts` | create_leaderboard, submit_score |

## ToolHandler Type

```ts
// web/src/lib/chat/handlers/types.ts
export interface HandlerContext {
  store: EditorStore;
  dispatchCommand: (name: string, params: Record<string, unknown>) => void;
  userId?: string;
}

export type ToolHandler = (
  args: Record<string, unknown>,
  context: HandlerContext,
) => Promise<ExecutionResult>;

export interface ExecutionResult {
  success: boolean;
  error?: string;
  message?: string;   // optional — helps the AI understand the outcome
  data?: unknown;     // optional — structured query results
}
```

## parseArgs() — Argument Validation

Use `parseArgs()` from `@/lib/chat/handlers/parseArgs` for type-safe arg extraction:

```ts
import { parseArgs } from './parseArgs';

export const handlers: Record<string, ToolHandler> = {
  my_command: async (args, { dispatchCommand }) => {
    const parsed = parseArgs(args, {
      entityId: { type: 'string', required: true },
      intensity: { type: 'number', required: false, default: 1.0 },
      mode: { type: 'string', required: false, enum: ['add', 'replace'] },
    });
    if (!parsed.success) return parsed; // returns { success: false, error: '...' }

    dispatchCommand('my_command', {
      entityId: parsed.data.entityId,
      intensity: parsed.data.intensity,
      mode: parsed.data.mode ?? 'replace',
    });

    return {
      success: true,
      message: `Applied to ${parsed.data.entityId}`,
    };
  },
};
```

## Adding a New Handler

1. Add to the domain handler file (or create a new file for a new domain)
2. Export from the file as part of the `handlers` map
3. Import and spread in `executor.ts` registry
4. Add display label in `web/src/components/chat/ToolCallCard.tsx`
5. Write a test in the co-located `__tests__/` directory

## ToolCallCard Display Labels

Every command needs a human-readable label in `ToolCallCard.tsx`:

```ts
// web/src/components/chat/ToolCallCard.tsx
case 'my_command': return 'Applying Effect';
case 'my_other_command': return 'Setting Property';
```

Without this, the chat UI shows the raw command name to the user.
