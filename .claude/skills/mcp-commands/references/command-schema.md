# MCP Command Schema Reference

Every entry in `mcp-server/manifest/commands.json` (and its copy at
`web/src/data/commands.json`) must conform to this schema.

## Required Fields

```json
{
  "name": "snake_case_command_name",
  "category": "existing_category",
  "description": "Clear description of what this command does...",
  "visibility": "public",
  "parameters": { ... }
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `name` | string | yes | snake_case, unique across all commands |
| `category` | string | yes | Must be an existing category — see list below |
| `description` | string | yes | Specific enough for AI to choose the right command |
| `visibility` | `"public"` or `"internal"` | YES | Manifest tests fail without this |
| `parameters` | JSON Schema object | yes | Use `{}` for zero-param commands |

## visibility Field

`visibility` is MANDATORY. Manifest tests in `mcp-server/src/manifest.test.ts` will fail
if any command is missing it.

- `"public"` — shown in the docs site command index and available to users
- `"internal"` — used by compound actions and the system; hidden from end-user docs

## Parameter Schema

Use JSON Schema draft-07 syntax inside the `parameters` object:

```json
"parameters": {
  "type": "object",
  "required": ["entityId"],
  "properties": {
    "entityId": {
      "type": "string",
      "description": "Target entity identifier (from scene graph)"
    },
    "intensity": {
      "type": "number",
      "description": "Effect strength from 0.0 (none) to 1.0 (full). Default: 1.0",
      "default": 1.0,
      "minimum": 0.0,
      "maximum": 1.0
    },
    "mode": {
      "type": "string",
      "enum": ["add", "subtract", "replace"],
      "description": "How to apply the change: add to existing, subtract, or fully replace"
    }
  }
}
```

## Description Quality Bar

The AI reads command descriptions to decide which command to use. Vague descriptions
cause wrong command selection. Include:

1. What the command does (not just the name restated)
2. Valid parameter ranges and units when relevant
3. Side effects (does it trigger events? modify other components?)
4. Prerequisites (does the entity need a specific component first?)

```json
// BAD — name restated, no useful detail
"description": "Set the physics enabled state."

// GOOD — specific, includes side effects and prerequisites
"description": "Enable or disable physics simulation on an entity. When enabled, the entity gains a Rapier collider and rigid body. Requires the entity to have a mesh component. Triggers a physics_changed event that updates the inspector panel."
```

## Valid Categories (41 total)

```
transform         material          lighting          physics
physics_2d        audio             animation         particles
scripting         scene             export            camera
environment       post_processing   shader            csg
terrain           procedural        prefab            game_component
game_camera       ui_widget         sprite            sprite_animation
tilemap           skeleton_2d       dialogue          lod
quality           joints            joints_2d         reverb_zone
audio_bus         adaptive_music    asset_generation  publishing
custom_shader     leaderboard       localization      cutscene
quest
```

When adding a new category, also update `validCategories` in
`mcp-server/src/manifest.test.ts`.

## Both Manifest Files Must Stay in Sync

```
mcp-server/manifest/commands.json   ← source of truth (edit here)
web/src/data/commands.json          ← COPY (run cp or validate-mcp.sh sync)
```

After editing the source:
```bash
cp mcp-server/manifest/commands.json web/src/data/commands.json
bash .claude/tools/validate-mcp.sh sync
```

## Response Format Convention

Commands that query state should return structured data:

```ts
// Query response — AI can use this for follow-up decisions
return {
  success: true,
  data: {
    entityId: 'abc-123',
    physics: { enabled: true, mass: 1.0, colliderType: 'box' },
  },
  message: 'Physics data for entity abc-123',
};

// Mutation response — confirm what changed
return {
  success: true,
  message: 'Physics enabled on entity abc-123 with box collider',
};

// Error response
return {
  success: false,
  error: 'Entity abc-123 not found in scene',
};
```
