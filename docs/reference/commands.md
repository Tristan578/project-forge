# Command Reference

Complete reference for all 351 MCP commands available in SpawnForge.

> This file is auto-generated from `mcp-server/manifest/commands.json`.
> Run `npx tsx docs/scripts/generate-reference.ts` to regenerate.

## Categories

- [Scene](#scene) (26 commands)
- [Materials](#materials) (11 commands)
- [Lighting](#lighting) (2 commands)
- [Environment](#environment) (5 commands)
- [Rendering](#rendering) (4 commands)
- [Editor](#editor) (7 commands)
- [Camera](#camera) (3 commands)
- [History](#history) (2 commands)
- [Query](#query) (15 commands)
- [Runtime](#runtime) (12 commands)
- [Asset](#asset) (5 commands)
- [Scripting](#scripting) (15 commands)
- [Audio](#audio) (28 commands)
- [Particles](#particles) (8 commands)
- [Animation](#animation) (20 commands)
- [Mesh](#mesh) (11 commands)
- [Terrain](#terrain) (4 commands)
- [Export](#export) (6 commands)
- [Documentation](#documentation) (3 commands)
- [Shaders](#shaders) (10 commands)
- [Prefab](#prefab) (5 commands)
- [Game_components](#game_components) (5 commands)
- [Game_cameras](#game_cameras) (4 commands)
- [Generation](#generation) (24 commands)
- [Ui](#ui) (15 commands)
- [Compound](#compound) (9 commands)
- [Templates](#templates) (3 commands)
- [Dialogue](#dialogue) (8 commands)
- [Publishing](#publishing) (8 commands)
- [Sprite](#sprite) (8 commands)
- [Sprite_animation](#sprite_animation) (6 commands)
- [Physics2d](#physics2d) (8 commands)
- [Tilemap](#tilemap) (10 commands)
- [Skeleton2d](#skeleton2d) (13 commands)
- [Modeling](#modeling) (6 commands)
- [Security](#security) (2 commands)
- [Performance](#performance) (7 commands)
- [World_building](#world_building) (3 commands)
- [Localization](#localization) (4 commands)
- [Economy](#economy) (1 commands)
- [Cutscene](#cutscene) (5 commands)

---

## Scene

### `spawn_entity`

Create a new entity in the scene (mesh primitive or light)

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityType` | `"cube"` \| `"sphere"` \| `"plane"` \| `"cylinder"` \| `"cone"` \| `"torus"` \| `"capsule"` \| `"point_light"` \| `"directional_light"` \| `"spot_light"` | Yes | Type of entity to spawn |
| `name` | string | No | Display name (auto-generated if omitted) |
| `id` | string | No | Caller-supplied entity id, letting the caller address the entity immediately instead of waiting for the async selection event. Trimmed, then honored only if 1-64 BYTES with no control characters - an id that fails those checks is NOT an error: the engine silently falls back to a random UUID. Auto-generated if omitted. |
| `position` | number[3] | No | World position [x, y, z] |

**Example:**
```json
{
  "command": "spawn_entity",
  "params": {
    "entityType": "cube"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `despawn_entity`

Remove an entity from the scene by ID

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Entity ID to remove |

**Example:**
```json
{
  "command": "despawn_entity",
  "params": {
    "entityId": "entity_1"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `delete_entities`

Delete one or more entities by their IDs

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityIds` | string[] | Yes | Array of entity IDs to delete |

**Example:**
```json
{
  "command": "delete_entities",
  "params": {
    "entityIds": [
      "entity_1"
    ]
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `duplicate_entity`

Duplicate an entity (creates a copy with offset position)

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Entity ID to duplicate |

**Example:**
```json
{
  "command": "duplicate_entity",
  "params": {
    "entityId": "entity_1"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `update_transform`

Set the position, rotation, and/or scale of an entity

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes |  |
| `position` | number[3] | No | [x, y, z] |
| `rotation` | number[3] | No | [rx, ry, rz] in degrees |
| `scale` | number[3] | No | [sx, sy, sz] |

**Example:**
```json
{
  "command": "update_transform",
  "params": {
    "entityId": "entity_1"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `rename_entity`

Change the display name of an entity

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes |  |
| `name` | string | Yes | New display name |

**Example:**
```json
{
  "command": "rename_entity",
  "params": {
    "entityId": "entity_1",
    "name": "my_name"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `reparent_entity`

Move an entity to a new parent in the hierarchy

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Entity to move |
| `newParentId` | string | No | New parent entity ID (null for root) |
| `index` | integer | No | Position among siblings (optional) |

**Example:**
```json
{
  "command": "reparent_entity",
  "params": {
    "entityId": "entity_1"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `set_visibility`

Show or hide an entity

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes |  |
| `visible` | boolean | Yes |  |

**Example:**
```json
{
  "command": "set_visibility",
  "params": {
    "entityId": "entity_1",
    "visible": true
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `select_entity`

Select an entity in the viewport

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes |  |
| `mode` | `"replace"` \| `"add"` \| `"toggle"` | No | Selection mode (default: replace) |

**Example:**
```json
{
  "command": "select_entity",
  "params": {
    "entityId": "entity_1"
  }
}
```

Scope: `scene:read` | Token cost: 0

---

### `select_entities`

Select multiple entities at once

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityIds` | string[] | Yes |  |
| `mode` | `"replace"` \| `"add"` | No | Selection mode (default: replace) |

**Example:**
```json
{
  "command": "select_entities",
  "params": {
    "entityIds": [
      "entity_1"
    ]
  }
}
```

Scope: `scene:read` | Token cost: 0

---

### `clear_selection`

Deselect all entities

**Example:**
```json
{
  "command": "clear_selection",
  "params": {}
}
```

Scope: `scene:read` | Token cost: 0

---

### `export_scene`

Export the current scene as a JSON string (.forge format). Triggers a SCENE_EXPORTED event with the full scene data.

**Example:**
```json
{
  "command": "export_scene",
  "params": {}
}
```

Scope: `scene:read` | Token cost: 0

---

### `load_scene`

Load a scene from a JSON string (.forge format). Replaces the entire current scene.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `json` | string | Yes | Complete scene JSON in .forge format |

**Example:**
```json
{
  "command": "load_scene",
  "params": {
    "json": "my_json"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `new_scene`

Clear the current scene and start fresh with default settings

**Example:**
```json
{
  "command": "new_scene",
  "params": {}
}
```

Scope: `scene:write` | Token cost: 0

---

### `create_scene`

Create a new empty scene in the project

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | Yes | Name for the new scene |

**Example:**
```json
{
  "command": "create_scene",
  "params": {
    "name": "my_name"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `switch_scene`

Switch to a different scene by name or ID

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sceneId` | string | Yes | Scene ID or name to switch to |

**Example:**
```json
{
  "command": "switch_scene",
  "params": {
    "sceneId": "my_sceneId"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `duplicate_scene`

Create a copy of an existing scene

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sceneId` | string | Yes | Scene ID or name to duplicate |
| `name` | string | No | Name for the duplicate |

**Example:**
```json
{
  "command": "duplicate_scene",
  "params": {
    "sceneId": "my_sceneId"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `delete_scene`

Delete a scene from the project

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sceneId` | string | Yes | Scene ID or name to delete |

**Example:**
```json
{
  "command": "delete_scene",
  "params": {
    "sceneId": "my_sceneId"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `rename_scene`

Rename a scene

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sceneId` | string | Yes | Scene ID or name |
| `name` | string | Yes | New name for the scene |

**Example:**
```json
{
  "command": "rename_scene",
  "params": {
    "sceneId": "my_sceneId",
    "name": "my_name"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `set_start_scene`

Set which scene loads first when the game starts

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sceneId` | string | Yes | Scene ID or name to set as start |

**Example:**
```json
{
  "command": "set_start_scene",
  "params": {
    "sceneId": "my_sceneId"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `create_joint`

Create a physics joint between two entities. Requires physics enabled on both. Joint types: fixed, revolute, spherical, prismatic, rope, spring. Applied in both the editor and exported (runtime) games (#9550).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Entity ID to attach the joint to |
| `jointType` | `"fixed"` \| `"revolute"` \| `"spherical"` \| `"prismatic"` \| `"rope"` \| `"spring"` | No | Type of joint constraint |
| `connectedEntityId` | string | Yes | Entity ID of the other body to connect to |
| `anchorSelf` | number[3] | No | Local anchor point on this entity [x, y, z] |
| `anchorOther` | number[3] | No | Local anchor point on the connected entity [x, y, z] |
| `axis` | number[3] | No | Joint axis for revolute/prismatic [x, y, z] |
| `limits` | object | No | Optional joint limits |
| `motor` | object | No | Optional motor settings |

**Example:**
```json
{
  "command": "create_joint",
  "params": {
    "entityId": "entity_1",
    "connectedEntityId": "my_connectedEntityId"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `update_joint`

Update joint properties on an entity. Applied in both the editor and exported (runtime) games (#9550).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Entity ID with the joint |
| `jointType` | `"fixed"` \| `"revolute"` \| `"spherical"` \| `"prismatic"` \| `"rope"` \| `"spring"` | No | Change joint type |
| `connectedEntityId` | string | No | Change connected entity |
| `anchorSelf` | number[3] | No | Update self anchor [x, y, z] |
| `anchorOther` | number[3] | No | Update other anchor [x, y, z] |
| `axis` | number[3] | No | Update joint axis [x, y, z] |
| `limits` | object,null | No | Set or remove limits (null to remove) |
| `motor` | object,null | No | Set or remove motor (null to remove) |

**Example:**
```json
{
  "command": "update_joint",
  "params": {
    "entityId": "entity_1"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `remove_joint`

Remove a physics joint from an entity. Applied in both the editor and exported (runtime) games (#9550).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Entity ID to remove joint from |

**Example:**
```json
{
  "command": "remove_joint",
  "params": {
    "entityId": "entity_1"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `list_scenes`

List all scenes in the project with metadata

**Example:**
```json
{
  "command": "list_scenes",
  "params": {}
}
```

Scope: `scene:read` | Token cost: 0

---

### `load_scene_with_transition`

Load a different scene with a visual transition effect. Can be used during play mode for level changes.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sceneName` | string | Yes | Name of the scene to load |
| `transitionType` | string | No | Transition type: fade, wipe, instant |
| `duration` | number | No | Transition duration in milliseconds |
| `color` | string | No | Transition color (hex) |
| `direction` | string | No | Wipe direction: left, right, up, down |

**Example:**
```json
{
  "command": "load_scene_with_transition",
  "params": {
    "sceneName": "my_sceneName"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `set_default_transition`

Set the default transition configuration used when switching scenes

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `transitionType` | string | No | Transition type: fade, wipe, instant |
| `duration` | number | No | Duration in milliseconds |
| `color` | string | No | Transition color (hex) |
| `direction` | string | No | Wipe direction: left, right, up, down |
| `easing` | string | No | Easing: linear, ease-in, ease-out, ease-in-out |

**Example:**
```json
{
  "command": "set_default_transition",
  "params": {}
}
```

Scope: `scene:write` | Token cost: 0

---

## Materials

### `update_material`

Update PBR material properties on an entity. Supports core PBR, UV transform, parallax, clearcoat, and transmission.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes |  |
| `baseColor` | number[4] | No | [r, g, b, a] 0-1 |
| `metallic` | number | No |  |
| `roughness` | number | No |  |
| `reflectance` | number | No |  |
| `emissive` | number[4] | No | [r, g, b, a] 0-1 |
| `emissiveExposureWeight` | number | No |  |
| `alphaMode` | `"Opaque"` \| `"Blend"` \| `"Mask"` | No |  |
| `alphaCutoff` | number | No |  |
| `doubleSided` | boolean | No |  |
| `unlit` | boolean | No |  |
| `uvOffset` | number[2] | No | [x, y] UV offset |
| `uvScale` | number[2] | No | [x, y] UV scale |
| `uvRotation` | number | No | UV rotation in radians |
| `parallaxDepthScale` | number | No |  |
| `parallaxMappingMethod` | `"occlusion"` \| `"relief"` | No |  |
| `maxParallaxLayerCount` | number | No |  |
| `parallaxReliefMaxSteps` | integer | No |  |
| `clearcoat` | number | No |  |
| `clearcoatPerceptualRoughness` | number | No |  |
| `specularTransmission` | number | No |  |
| `diffuseTransmission` | number | No |  |
| `ior` | number | No | Index of refraction (1.0=air, 1.33=water, 1.5=glass, 2.42=diamond) |
| `thickness` | number | No | Optical depth for transmission |
| `attenuationDistance` | number | No | Distance light travels before being attenuated. Use null for infinity. |
| `attenuationColor` | number[3] | No | [r, g, b] 0-1 attenuation tint |

**Example:**
```json
{
  "command": "update_material",
  "params": {
    "entityId": "entity_1"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `apply_material_preset`

Apply a predefined material preset to an entity by name

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Entity to apply the preset to |
| `presetId` | `"default_gray"` \| `"matte_white"` \| `"matte_black"` \| `"chalk_white"` \| `"clay"` \| `"plastic_basic"` \| `"polished_metal"` \| `"brushed_metal"` \| `"gold"` \| `"silver"` \| `"copper"` \| `"bronze"` \| `"iron"` \| `"chrome"` \| `"titanium"` \| `"aluminum"` \| `"concrete"` \| `"marble"` \| `"granite"` \| `"sand"` \| `"dirt"` \| `"brick"` \| `"leather"` \| `"ice"` \| `"glass"` \| `"water"` \| `"frosted_glass"` \| `"crystal"` \| `"diamond"` \| `"ceramic"` \| `"car_paint"` \| `"neon_glow"` \| `"lava"` \| `"holographic"` \| `"mirror"` \| `"cotton"` \| `"silk"` \| `"velvet"` \| `"denim"` \| `"wool"` \| `"canvas"` \| `"glossy_plastic"` \| `"matte_plastic"` \| `"rubber_soft"` \| `"acrylic"` \| `"resin"` \| `"slate"` \| `"limestone"` \| `"obsidian"` \| `"sandstone"` \| `"cobblestone"` \| `"oak"` \| `"pine"` \| `"walnut"` \| `"bamboo"` \| `"plywood"` | Yes | Preset identifier |

**Example:**
```json
{
  "command": "apply_material_preset",
  "params": {
    "entityId": "entity_1",
    "presetId": "default_gray"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `set_custom_shader`

Apply a custom shader effect to an entity, extending its PBR material with visual effects

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Target entity ID |
| `shaderType` | `"none"` \| `"dissolve"` \| `"hologram"` \| `"force_field"` \| `"lava_flow"` \| `"toon"` \| `"fresnel_glow"` | Yes | Shader effect type |
| `customColor` | number[4] | No | Custom tint color [r,g,b,a] 0-1 |
| `noiseScale` | number | No | Noise pattern scale (0.5-20) |
| `emissionStrength` | number | No | Glow intensity (0-10) |
| `dissolveThreshold` | number | No | Dissolve amount 0-1 |
| `dissolveEdgeWidth` | number | No | Edge glow width (0-0.2) |
| `scanLineFrequency` | number | No | Hologram scan line count (10-200) |
| `scanLineSpeed` | number | No | Hologram scan line speed (0.5-10) |
| `scrollSpeed` | number[2] | No | UV scroll speed [x,y] |
| `distortionStrength` | number | No | Flow distortion amount (0-1) |
| `toonBands` | integer | No | Cel-shade band count (2-8) |
| `fresnelPower` | number | No | Rim light falloff (1-10) |

**Example:**
```json
{
  "command": "set_custom_shader",
  "params": {
    "entityId": "entity_1",
    "shaderType": "none"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `remove_custom_shader`

Remove custom shader effect from an entity, reverting to standard PBR rendering

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Target entity ID |

**Example:**
```json
{
  "command": "remove_custom_shader",
  "params": {
    "entityId": "entity_1"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `list_shaders`

List all available built-in shader effects with their descriptions

**Example:**
```json
{
  "command": "list_shaders",
  "params": {}
}
```

Scope: `scene:read` | Token cost: 0

---

### `set_custom_wgsl_source`

Set the scene-global custom WGSL shader source code. All entities with shaderType='custom_wgsl' use this code. WebGPU only — WebGL2 falls back to standard PBR. The userCode is a WGSL function body receiving base_color, world_pos, world_normal, uv, time, user_params_0..3, user_color and must return vec4<f32>.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `userCode` | string | Yes | WGSL function body. Must return vec4<f32>. Do NOT include @group/@binding, fn fragment, fn vertex, textureStore, or atomicStore. |
| `name` | string | No | Human-readable shader name (optional, defaults to 'Custom WGSL') |

**Example:**
```json
{
  "command": "set_custom_wgsl_source",
  "params": {
    "userCode": "my_userCode"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `validate_wgsl`

Validate WGSL source code against heuristic rules without applying it. Returns success if valid, or an error message describing the problem.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `code` | string | Yes | WGSL code string to validate |

**Example:**
```json
{
  "command": "validate_wgsl",
  "params": {
    "code": "my_code"
  }
}
```

Scope: `scene:read` | Token cost: 0

---

### `list_material_presets`

List all available material presets with their IDs, names, categories, and descriptions. Use this to discover materials before applying them.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `category` | `"basic"` \| `"metal"` \| `"natural"` \| `"glass"` \| `"special"` \| `"fabric"` \| `"plastic"` \| `"stone"` \| `"wood"` | No | Optional filter by category |

**Example:**
```json
{
  "command": "list_material_presets",
  "params": {}
}
```

Scope: `scene:read` | Token cost: 0

---

### `save_material_to_library`

Save the current material of the selected entity as a named custom preset in the material library.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | Yes | Name for the custom material preset |

**Example:**
```json
{
  "command": "save_material_to_library",
  "params": {
    "name": "my_name"
  }
}
```

Scope: `scene:write` | Token cost: 1

---

### `delete_library_material`

Delete a custom material from the material library by its ID.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `materialId` | string | Yes | ID of the custom material to delete |

**Example:**
```json
{
  "command": "delete_library_material",
  "params": {
    "materialId": "my_materialId"
  }
}
```

Scope: `scene:write` | Token cost: 1

---

### `list_custom_materials`

List all custom materials saved in the material library

**Example:**
```json
{
  "command": "list_custom_materials",
  "params": {}
}
```

Scope: `scene:read` | Token cost: 0

---

## Lighting

### `update_light`

Update light properties on a light entity

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes |  |
| `color` | number[3] | No | [r, g, b] 0-1 |
| `intensity` | number | No | Light intensity in lumens |
| `shadowsEnabled` | boolean | No |  |
| `shadowDepthBias` | number | No |  |
| `shadowNormalBias` | number | No |  |
| `range` | number | No | Point/Spot light range |
| `radius` | number | No | Point/Spot light radius |
| `innerAngle` | number | No | Spot light inner cone angle (radians) |
| `outerAngle` | number | No | Spot light outer cone angle (radians) |

**Example:**
```json
{
  "command": "update_light",
  "params": {
    "entityId": "entity_1"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `update_ambient_light`

Update the scene's ambient light

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `color` | number[3] | No | [r, g, b] 0-1 |
| `brightness` | number | No | Ambient brightness multiplier |

**Example:**
```json
{
  "command": "update_ambient_light",
  "params": {}
}
```

Scope: `scene:write` | Token cost: 0

---

## Environment

### `update_environment`

Update environment settings (clear color, fog)

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `clearColor` | number[3] | No | [r, g, b] 0-1 |
| `fogEnabled` | boolean | No |  |
| `fogColor` | number[3] | No |  |
| `fogStart` | number | No |  |
| `fogEnd` | number | No |  |
| `skyboxBrightness` | number | No |  |
| `iblIntensity` | number | No |  |
| `iblRotation` | number | No |  |

**Example:**
```json
{
  "command": "update_environment",
  "params": {}
}
```

Scope: `scene:write` | Token cost: 0

---

### `set_skybox`

Set the scene skybox to a built-in preset or custom cubemap asset

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `preset` | `"studio"` \| `"sunset"` \| `"overcast"` \| `"night"` \| `"bright_day"` | No | Built-in skybox preset |
| `assetId` | string | No | Asset ID of an imported KTX2 cubemap (not yet supported) |
| `brightness` | number | No | Skybox brightness (100-5000, default 1000) |
| `iblIntensity` | number | No | Image-based lighting intensity (100-5000, default 900) |
| `rotation` | number | No | Skybox rotation in degrees (0-360) |

**Example:**
```json
{
  "command": "set_skybox",
  "params": {}
}
```

Scope: `scene:write` | Token cost: 0

---

### `remove_skybox`

Remove the scene skybox, reverting to clear color background

**Example:**
```json
{
  "command": "remove_skybox",
  "params": {}
}
```

Scope: `scene:write` | Token cost: 0

---

### `update_skybox`

Update skybox brightness, IBL intensity, or rotation without changing the cubemap

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `brightness` | number | No | Skybox brightness (100-5000) |
| `iblIntensity` | number | No | Image-based lighting intensity (100-5000) |
| `rotation` | number | No | Skybox rotation in degrees (0-360) |

**Example:**
```json
{
  "command": "update_skybox",
  "params": {}
}
```

Scope: `scene:write` | Token cost: 0

---

### `set_custom_skybox`

Apply a custom skybox from a base64-encoded image asset

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `assetId` | string | Yes | Asset identifier for the skybox image |
| `dataBase64` | string | Yes | Base64-encoded image data |

**Example:**
```json
{
  "command": "set_custom_skybox",
  "params": {
    "assetId": "my_assetId",
    "dataBase64": "my_dataBase64"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

## Rendering

### `update_post_processing`

Update post-processing visual effects (bloom, chromatic aberration, color grading, sharpening, SSAO, depth of field, motion blur). Send only the effects you want to change.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `bloom` | object | No | Bloom (glow) settings |
| `chromaticAberration` | object | No | Chromatic aberration (color fringe) settings |
| `colorGrading` | object | No | Color grading settings (exposure, temperature, saturation, etc.) |
| `sharpening` | object | No | Contrast adaptive sharpening settings |
| `ssao` | object,null | No | Screen-space ambient occlusion (WebGPU only). Send null to disable. |
| `depthOfField` | object,null | No | Depth of field (camera focus blur). Send null to disable. |
| `motionBlur` | object,null | No | Motion blur (velocity-based blur). Send null to disable. |

**Example:**
```json
{
  "command": "update_post_processing",
  "params": {}
}
```

Scope: `rendering:write` | Token cost: 0

---

### `get_post_processing`

Get current post-processing settings (bloom, chromatic aberration, color grading, sharpening)

**Example:**
```json
{
  "command": "get_post_processing",
  "params": {}
}
```

Scope: `rendering:read` | Token cost: 0

---

### `set_quality_preset`

Set a rendering quality preset that adjusts MSAA, shadows, bloom, sharpening, and particle density all at once

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `preset` | `"low"` \| `"medium"` \| `"high"` \| `"ultra"` | Yes | Quality preset level |

**Example:**
```json
{
  "command": "set_quality_preset",
  "params": {
    "preset": "low"
  }
}
```

Scope: `scene:write` | Token cost: 1

---

### `get_quality_settings`

Get the current quality preset and all rendering quality parameters

**Example:**
```json
{
  "command": "get_quality_settings",
  "params": {}
}
```

Scope: `scene:read` | Token cost: 0

---

## Editor

### `set_gizmo_mode`

Change the transform gizmo mode

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `mode` | `"translate"` \| `"rotate"` \| `"scale"` | Yes |  |

**Example:**
```json
{
  "command": "set_gizmo_mode",
  "params": {
    "mode": "translate"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `set_coordinate_mode`

Toggle between world and local coordinate systems

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `mode` | `"world"` \| `"local"` | Yes |  |

**Example:**
```json
{
  "command": "set_coordinate_mode",
  "params": {
    "mode": "world"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `set_snap_settings`

Configure grid snapping parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `translationSnap` | number | No | Snap grid size in world units |
| `rotationSnapDegrees` | number | No |  |
| `scaleSnap` | number | No |  |
| `gridVisible` | boolean | No |  |
| `gridSize` | number | No |  |
| `gridExtent` | integer | No |  |

**Example:**
```json
{
  "command": "set_snap_settings",
  "params": {}
}
```

Scope: `scene:write` | Token cost: 0

---

### `toggle_grid`

Show or hide the editor grid

**Example:**
```json
{
  "command": "toggle_grid",
  "params": {}
}
```

Scope: `scene:write` | Token cost: 0

---

### `toggle_debug_physics`

Toggle debug wireframe rendering of physics colliders. Applied in both the editor and exported (runtime) games (#9550).

**Example:**
```json
{
  "command": "toggle_debug_physics",
  "params": {}
}
```

Scope: `scene:write` | Token cost: 0

---

### `set_project_type`

Switch between 2D and 3D project modes

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `project_type` | `"2d"` \| `"3d"` | Yes | Project type |

**Example:**
```json
{
  "command": "set_project_type",
  "params": {
    "project_type": "2d"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `set_grid_2d`

Configure 2D grid settings for snap-to-grid placement

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `enabled` | boolean | No | Enable/disable grid display |
| `size` | number | No | Grid cell size in world units |
| `snapToGrid` | boolean | No | Enable snap-to-grid for entity placement |

**Example:**
```json
{
  "command": "set_grid_2d",
  "params": {}
}
```

Scope: `scene:write` | Token cost: 0

---

## Camera

### `set_camera_preset`

Move the editor camera to a preset view

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `preset` | `"top"` \| `"front"` \| `"right"` \| `"perspective"` | Yes | Camera preset |

**Example:**
```json
{
  "command": "set_camera_preset",
  "params": {
    "preset": "top"
  }
}
```

Scope: `scene:read` | Token cost: 0

---

### `focus_camera`

Frame the camera on the selected entity

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | No | Entity to focus on (defaults to current selection) |

**Example:**
```json
{
  "command": "focus_camera",
  "params": {}
}
```

Scope: `scene:read` | Token cost: 0

---

### `set_camera_2d`

Configure 2D camera settings (zoom, pixel-perfect rendering, bounds)

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `zoom` | number | No | Camera zoom level (1.0 = default) |
| `pixelPerfect` | boolean | No | Enable pixel-perfect rendering |
| `bounds` | object | No | Camera bounds [min, max] or null for unbounded |

**Example:**
```json
{
  "command": "set_camera_2d",
  "params": {}
}
```

Scope: `scene:write` | Token cost: 0

---

## History

### `undo`

Undo the last action

**Example:**
```json
{
  "command": "undo",
  "params": {}
}
```

Scope: `scene:write` | Token cost: 0

---

### `redo`

Redo the last undone action

**Example:**
```json
{
  "command": "redo",
  "params": {}
}
```

Scope: `scene:write` | Token cost: 0

---

## Query

### `get_scene_graph`

Get the full scene hierarchy as JSON

**Example:**
```json
{
  "command": "get_scene_graph",
  "params": {}
}
```

Scope: `scene:read` | Token cost: 0

---

### `get_entity_details`

Get all component data for a specific entity

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes |  |

**Example:**
```json
{
  "command": "get_entity_details",
  "params": {
    "entityId": "entity_1"
  }
}
```

Scope: `scene:read` | Token cost: 0

---

### `get_selection`

Get the currently selected entity IDs

**Example:**
```json
{
  "command": "get_selection",
  "params": {}
}
```

Scope: `scene:read` | Token cost: 0

---

### `get_camera_state`

Get the current editor camera position, target, and orientation

**Example:**
```json
{
  "command": "get_camera_state",
  "params": {}
}
```

Scope: `scene:read` | Token cost: 0

---

### `get_input_bindings`

Get all current input action bindings and active preset

**Example:**
```json
{
  "command": "get_input_bindings",
  "params": {}
}
```

Scope: `scene:read` | Token cost: 0

---

### `get_input_state`

Get current per-frame input state (only meaningful during Play mode)

**Example:**
```json
{
  "command": "get_input_state",
  "params": {}
}
```

Scope: `scene:read` | Token cost: 0

---

### `get_physics`

Get physics configuration for the selected entity

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | No | Entity ID (defaults to primary selection) |

**Example:**
```json
{
  "command": "get_physics",
  "params": {}
}
```

Scope: `scene:read` | Token cost: 0

---

### `get_scene_name`

Get the current scene name and modification status

**Example:**
```json
{
  "command": "get_scene_name",
  "params": {}
}
```

Scope: `scene:read` | Token cost: 0

---

### `list_assets`

List all assets currently in the registry with their metadata

**Example:**
```json
{
  "command": "list_assets",
  "params": {}
}
```

Scope: `scene:read` | Token cost: 0

---

### `get_script`

Get the script source and status for an entity

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Entity to get script from |

**Example:**
```json
{
  "command": "get_script",
  "params": {
    "entityId": "entity_1"
  }
}
```

Scope: `scene:read` | Token cost: 0

---

### `list_script_templates`

List available script templates (Character Controller, Collectible, Rotating Object, Follow Camera)

**Example:**
```json
{
  "command": "list_script_templates",
  "params": {}
}
```

Scope: `scene:read` | Token cost: 0

---

### `get_joint`

Get the joint configuration for the selected entity. Applied in both the editor and exported (runtime) games (#9550).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | No | Entity ID (defaults to primary selection) |

**Example:**
```json
{
  "command": "get_joint",
  "params": {}
}
```

Scope: `scene:read` | Token cost: 0

---

### `get_token_balance`

Get the current token/credit balance breakdown (monthly, purchased, earned)

**Example:**
```json
{
  "command": "get_token_balance",
  "params": {}
}
```

Scope: `scene:read` | Token cost: 0

---

### `get_token_pricing`

Get the current token costs for all AI operations

**Example:**
```json
{
  "command": "get_token_pricing",
  "params": {}
}
```

Scope: `scene:read` | Token cost: 0

---

### `query_play_state`

Query current game state during play mode. Returns entity names, visibility, and engine mode for AI debugging. Only available in Play or Paused mode.

**Example:**
```json
{
  "command": "query_play_state",
  "params": {}
}
```

Scope: `scene:read` | Token cost: 0

---

## Runtime

### `play`

Enter play mode — starts game simulation, snapshots scene state

**Example:**
```json
{
  "command": "play",
  "params": {}
}
```

Scope: `scene:write` | Token cost: 0

---

### `stop`

Stop play mode — restores scene to pre-play state

**Example:**
```json
{
  "command": "stop",
  "params": {}
}
```

Scope: `scene:write` | Token cost: 0

---

### `pause`

Pause play mode — freezes simulation

**Example:**
```json
{
  "command": "pause",
  "params": {}
}
```

Scope: `scene:write` | Token cost: 0

---

### `resume`

Resume play mode from paused state

**Example:**
```json
{
  "command": "resume",
  "params": {}
}
```

Scope: `scene:write` | Token cost: 0

---

### `get_mode`

Get current engine mode (edit, play, or paused)

**Example:**
```json
{
  "command": "get_mode",
  "params": {}
}
```

Scope: `scene:read` | Token cost: 0

---

### `set_input_binding`

Create or update an input action binding (e.g. map 'jump' to Space key)

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `actionName` | string | Yes | Name of the input action (e.g. 'jump', 'move_forward') |
| `actionType` | `"digital"` \| `"axis"` | Yes | digital = on/off, axis = -1..+1 |
| `sources` | string[] | No | Key codes for digital actions (e.g. ['Space', 'KeyW']) |
| `positiveKeys` | string[] | No | Positive direction keys for axis actions |
| `negativeKeys` | string[] | No | Negative direction keys for axis actions |
| `deadZone` | number | No | Dead zone for axis (default 0.1) |

**Example:**
```json
{
  "command": "set_input_binding",
  "params": {
    "actionName": "my_actionName",
    "actionType": "digital"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `remove_input_binding`

Remove an input action binding by name

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `actionName` | string | Yes | Name of the action to remove |

**Example:**
```json
{
  "command": "remove_input_binding",
  "params": {
    "actionName": "my_actionName"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `set_input_preset`

Apply a built-in input preset (replaces all bindings)

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `preset` | `"fps"` \| `"platformer"` \| `"topdown"` \| `"racing"` | Yes | Preset name |

**Example:**
```json
{
  "command": "set_input_preset",
  "params": {
    "preset": "fps"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `update_physics`

Set physics properties on an entity (body type, collider, restitution, friction, density, gravity, locked axes)

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Entity ID to configure |
| `bodyType` | `"dynamic"` \| `"fixed"` \| `"kinematic_position"` \| `"kinematic_velocity"` | No | Rigid body type |
| `colliderShape` | `"auto"` \| `"cuboid"` \| `"ball"` \| `"cylinder"` \| `"capsule"` | No | Collider shape |
| `restitution` | number | No | Bounciness (0-1) |
| `friction` | number | No | Surface friction (0-1) |
| `density` | number | No | Mass density |
| `gravityScale` | number | No | Gravity multiplier (-10 to 10) |
| `lockTranslationX` | boolean | No |  |
| `lockTranslationY` | boolean | No |  |
| `lockTranslationZ` | boolean | No |  |
| `lockRotationX` | boolean | No |  |
| `lockRotationY` | boolean | No |  |
| `lockRotationZ` | boolean | No |  |
| `isSensor` | boolean | No | If true, detects overlap without blocking |

**Example:**
```json
{
  "command": "update_physics",
  "params": {
    "entityId": "entity_1"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `toggle_physics`

Enable or disable physics simulation on an entity

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Entity ID |
| `enabled` | boolean | Yes | true to enable, false to disable |

**Example:**
```json
{
  "command": "toggle_physics",
  "params": {
    "entityId": "entity_1",
    "enabled": true
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `apply_force`

Apply a force or impulse to an entity during Play mode

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Entity ID to apply force to |
| `force` | number[3] | No | Force vector [x, y, z] |
| `impulse` | number[3] | No | Impulse vector [x, y, z] (instant) |
| `torque` | number[3] | No | Torque vector [x, y, z] |

**Example:**
```json
{
  "command": "apply_force",
  "params": {
    "entityId": "entity_1"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `raycast_query`

Cast a ray from origin in direction and return the first entity hit. Results arrive asynchronously via RAYCAST_RESULT event.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `origin` | number[3] | Yes | Ray origin [x, y, z] |
| `direction` | number[3] | Yes | Ray direction [x, y, z] (normalized) |
| `maxDistance` | number | No | Maximum ray distance (default 100) |
| `requestId` | string | No | Optional request ID for tracking (auto-generated if omitted) |

**Example:**
```json
{
  "command": "raycast_query",
  "params": {
    "origin": [
      0,
      0,
      0
    ],
    "direction": [
      0,
      0,
      0
    ]
  }
}
```

Scope: `scene:read` | Token cost: 0

---

## Asset

### `import_gltf`

Import a glTF/GLB 3D model file (base64-encoded data) into the asset registry and scene

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `dataBase64` | string | Yes | Base64-encoded glTF/GLB file data |
| `name` | string | Yes | Display name for the imported model |

**Example:**
```json
{
  "command": "import_gltf",
  "params": {
    "dataBase64": "my_dataBase64",
    "name": "my_name"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `load_texture`

Load a texture image and assign it to a material slot on an entity

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `dataBase64` | string | Yes | Base64-encoded image data (PNG/JPG) |
| `name` | string | Yes | Display name for the texture |
| `entityId` | string | Yes | Entity to apply texture to |
| `slot` | `"base_color"` \| `"normal_map"` \| `"metallic_roughness"` \| `"emissive"` \| `"occlusion"` | Yes | Material texture slot |

**Example:**
```json
{
  "command": "load_texture",
  "params": {
    "dataBase64": "my_dataBase64",
    "name": "my_name",
    "entityId": "entity_1",
    "slot": "base_color"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `remove_texture`

Remove a texture from a material slot on an entity

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Entity to remove texture from |
| `slot` | `"base_color"` \| `"normal_map"` \| `"metallic_roughness"` \| `"emissive"` \| `"occlusion"` | Yes | Material texture slot to clear |

**Example:**
```json
{
  "command": "remove_texture",
  "params": {
    "entityId": "entity_1",
    "slot": "base_color"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `place_asset`

Spawn a new instance of a previously imported asset in the scene

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `assetId` | string | Yes | Asset ID from the registry |

**Example:**
```json
{
  "command": "place_asset",
  "params": {
    "assetId": "my_assetId"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `delete_asset`

Remove an asset from the registry (does not affect entities already placed in scene)

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `assetId` | string | Yes | Asset ID to remove |

**Example:**
```json
{
  "command": "delete_asset",
  "params": {
    "assetId": "my_assetId"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

## Scripting

### `create_script`

Create and attach a new TypeScript script to an entity. Accepts entityId (defaults to primary selection), source code (required), optional enabled flag, and template hint.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | No | Entity to attach the script to. Defaults to the currently selected entity if omitted. |
| `source` | string | Yes | TypeScript source code with optional onStart/onUpdate/onDestroy lifecycle functions |
| `enabled` | boolean | No | Whether the script should run immediately (default: true) |
| `template` | string | No | Optional template hint (e.g. 'character_controller') for UI display |

**Example:**
```json
{
  "command": "create_script",
  "params": {
    "source": "my_source"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `set_script`

Set or update TypeScript script source on an entity (lifecycle: onStart, onUpdate, onDestroy)

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Entity to attach script to |
| `source` | string | Yes | TypeScript source code with onStart/onUpdate/onDestroy functions |
| `enabled` | boolean | No | Whether script is active (default: true) |
| `template` | string | No | Optional label recording which template (if any) this script originated from |

**Example:**
```json
{
  "command": "set_script",
  "params": {
    "entityId": "entity_1",
    "source": "my_source"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `remove_script`

Remove a script from an entity

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Entity to remove script from |

**Example:**
```json
{
  "command": "remove_script",
  "params": {
    "entityId": "entity_1"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `apply_script_template`

Apply a named script template to an entity

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Entity to apply template to |
| `template` | `"character_controller"` \| `"collectible"` \| `"rotating_object"` \| `"follow_camera"` | Yes | Template name |
| `source` | string | Yes | TypeScript source to attach for this template application |

**Example:**
```json
{
  "command": "apply_script_template",
  "params": {
    "entityId": "entity_1",
    "template": "character_controller",
    "source": "my_source"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `create_library_script`

Create a new standalone script in the script library (not attached to any entity)

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | Yes | Script name |
| `source` | string | Yes | TypeScript source code |
| `description` | string | No | Brief description of what the script does |
| `tags` | string[] | No | Tags for categorization |

**Example:**
```json
{
  "command": "create_library_script",
  "params": {
    "name": "my_name",
    "source": "my_source"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `update_library_script`

Update an existing script in the script library

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `scriptId` | string | Yes | Script ID or name |
| `name` | string | No | New name |
| `source` | string | No | New source code |
| `description` | string | No | New description |
| `tags` | string[] | No | New tags |

**Example:**
```json
{
  "command": "update_library_script",
  "params": {
    "scriptId": "my_scriptId"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `delete_library_script`

Delete a script from the script library

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `scriptId` | string | Yes | Script ID or name to delete |

**Example:**
```json
{
  "command": "delete_library_script",
  "params": {
    "scriptId": "my_scriptId"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `list_library_scripts`

List all scripts in the script library with metadata

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | No | Search filter (matches name, description, tags) |

**Example:**
```json
{
  "command": "list_library_scripts",
  "params": {}
}
```

Scope: `scene:read` | Token cost: 0

---

### `attach_script_to_entity`

Copy a script from the library and attach it to an entity

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `scriptId` | string | Yes | Library script ID or name |
| `entityId` | string | Yes | Entity to attach the script to |

**Example:**
```json
{
  "command": "attach_script_to_entity",
  "params": {
    "scriptId": "my_scriptId",
    "entityId": "entity_1"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `detach_script_from_entity`

Remove the script from an entity (same as remove_script but with explicit intent naming)

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Entity to detach script from |

**Example:**
```json
{
  "command": "detach_script_from_entity",
  "params": {
    "entityId": "entity_1"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `set_visual_script`

Set the visual script graph for an entity

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Entity to set script on |
| `graph` | object | Yes | Visual script graph JSON (nodes and edges) |

**Example:**
```json
{
  "command": "set_visual_script",
  "params": {
    "entityId": "entity_1"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `get_visual_script`

Get the visual script graph for an entity

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Entity to get script from |

**Example:**
```json
{
  "command": "get_visual_script",
  "params": {
    "entityId": "entity_1"
  }
}
```

Scope: `scene:read` | Token cost: 0

---

### `compile_visual_script`

Compile a visual script graph to TypeScript code

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Entity whose visual script to compile |

**Example:**
```json
{
  "command": "compile_visual_script",
  "params": {
    "entityId": "entity_1"
  }
}
```

Scope: `scene:read` | Token cost: 0

---

### `add_visual_script_node`

Add a node to the visual script graph (stub: acknowledges the node type but does not yet persist graph state; get_visual_script always returns an empty graph)

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `nodeType` | string | Yes | Node type (e.g., OnUpdate, Translate, Branch) |

**Example:**
```json
{
  "command": "add_visual_script_node",
  "params": {
    "nodeType": "my_nodeType"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `connect_visual_script_nodes`

Connect two nodes in the visual script graph (stub: validates the connection shape but does not yet persist graph state; get_visual_script always returns an empty graph)

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sourceNodeId` | string | Yes | Source node ID |
| `sourcePort` | string | Yes | Source output port ID |
| `targetNodeId` | string | Yes | Target node ID |
| `targetPort` | string | Yes | Target input port ID |

**Example:**
```json
{
  "command": "connect_visual_script_nodes",
  "params": {
    "sourceNodeId": "my_sourceNodeId",
    "sourcePort": "my_sourcePort",
    "targetNodeId": "my_targetNodeId",
    "targetPort": "my_targetPort"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

## Audio

### `set_audio`

Set or update audio component on an entity

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Entity to attach audio to |
| `assetId` | string | No | Audio asset ID (optional) |
| `volume` | number | No | Volume (0-1) |
| `pitch` | number | No | Playback rate (0.25-4.0) |
| `loopAudio` | boolean | No | Loop playback |
| `spatial` | boolean | No | Enable 3D spatial audio |
| `maxDistance` | number | No | Max distance for spatial falloff |
| `refDistance` | number | No | Reference distance for spatial audio |
| `rolloffFactor` | number | No | Rolloff factor for distance attenuation |
| `autoplay` | boolean | No | Auto-play when entering Play mode |

**Example:**
```json
{
  "command": "set_audio",
  "params": {
    "entityId": "entity_1"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `remove_audio`

Remove audio component from an entity

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Entity to remove audio from |

**Example:**
```json
{
  "command": "remove_audio",
  "params": {
    "entityId": "entity_1"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `play_audio`

Play audio on an entity

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Entity with audio component |

**Example:**
```json
{
  "command": "play_audio",
  "params": {
    "entityId": "entity_1"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `stop_audio`

Stop audio playback on an entity

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Entity with audio component |

**Example:**
```json
{
  "command": "stop_audio",
  "params": {
    "entityId": "entity_1"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `pause_audio`

Pause audio playback on an entity

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Entity with audio component |

**Example:**
```json
{
  "command": "pause_audio",
  "params": {
    "entityId": "entity_1"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `get_audio`

Get audio data for an entity

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Entity to query |

**Example:**
```json
{
  "command": "get_audio",
  "params": {
    "entityId": "entity_1"
  }
}
```

Scope: `scene:read` | Token cost: 0

---

### `import_audio`

Import an audio file into the asset registry

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `dataBase64` | string | Yes | Base64-encoded audio file data |
| `name` | string | Yes | Filename (e.g., 'music.mp3') |

**Example:**
```json
{
  "command": "import_audio",
  "params": {
    "dataBase64": "my_dataBase64",
    "name": "my_name"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `update_audio_bus`

Update volume, mute, or solo state of an audio bus

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `busName` | string | Yes | Name of the audio bus |
| `volume` | number | No | Volume (0.0-1.0) |
| `muted` | boolean | No | Mute state |
| `soloed` | boolean | No | Solo state |

**Example:**
```json
{
  "command": "update_audio_bus",
  "params": {
    "busName": "my_busName"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `create_audio_bus`

Create a new audio bus

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | Yes | Name of the new bus |
| `volume` | number | No | Initial volume (0.0-1.0, default 1.0) |

**Example:**
```json
{
  "command": "create_audio_bus",
  "params": {
    "name": "my_name"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `delete_audio_bus`

Delete a custom audio bus (cannot delete master/default buses)

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `busName` | string | Yes | Name of the bus to delete |

**Example:**
```json
{
  "command": "delete_audio_bus",
  "params": {
    "busName": "my_busName"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `get_audio_buses`

Query the current audio bus configuration

**Example:**
```json
{
  "command": "get_audio_buses",
  "params": {}
}
```

Scope: `scene:read` | Token cost: 0

---

### `set_bus_effects`

Set the effects chain for an audio bus

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `busName` | string | Yes | Name of the audio bus |
| `effects` | object[] | Yes | Array of effect definitions |

**Example:**
```json
{
  "command": "set_bus_effects",
  "params": {
    "busName": "my_busName",
    "effects": []
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `audio_crossfade`

Crossfade audio between two entities over a duration

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `fromEntityId` | string | Yes | Entity to fade out |
| `toEntityId` | string | Yes | Entity to fade in |
| `durationMs` | number | Yes | Crossfade duration in milliseconds |

**Example:**
```json
{
  "command": "audio_crossfade",
  "params": {
    "fromEntityId": "my_fromEntityId",
    "toEntityId": "my_toEntityId",
    "durationMs": 1
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `audio_fade_in`

Fade in audio on an entity from silence to current volume

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Entity with audio |
| `durationMs` | number | Yes | Fade duration in milliseconds |

**Example:**
```json
{
  "command": "audio_fade_in",
  "params": {
    "entityId": "entity_1",
    "durationMs": 1
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `audio_fade_out`

Fade out audio on an entity from current volume to silence

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Entity with audio |
| `durationMs` | number | Yes | Fade duration in milliseconds |

**Example:**
```json
{
  "command": "audio_fade_out",
  "params": {
    "entityId": "entity_1",
    "durationMs": 1
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `audio_play_one_shot`

Play a fire-and-forget one-shot sound (no entity attachment needed)

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `assetId` | string | Yes | Audio asset ID to play |
| `position` | number[3] | No | Optional world position for spatial audio [x, y, z] |
| `bus` | string | No | Audio bus to route to (default: sfx) |
| `volume` | number | No | Volume (0-1) |
| `pitch` | number | No | Playback rate |

**Example:**
```json
{
  "command": "audio_play_one_shot",
  "params": {
    "assetId": "my_assetId"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `audio_add_layer`

Add a layered audio source to an entity (runtime only, for multi-source)

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Entity to add layer to |
| `slotName` | string | Yes | Unique slot name for this layer |
| `assetId` | string | Yes | Audio asset ID |
| `volume` | number | No | Volume (0-1) |
| `loop` | boolean | No | Loop playback |
| `bus` | string | No | Audio bus (default: sfx) |

**Example:**
```json
{
  "command": "audio_add_layer",
  "params": {
    "entityId": "entity_1",
    "slotName": "my_slotName",
    "assetId": "my_assetId"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `audio_remove_layer`

Remove a layered audio source from an entity

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Entity to remove layer from |
| `slotName` | string | Yes | Slot name to remove |

**Example:**
```json
{
  "command": "audio_remove_layer",
  "params": {
    "entityId": "entity_1",
    "slotName": "my_slotName"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `set_ducking_rule`

Set an audio ducking rule (target bus volume ducks when trigger bus plays)

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `triggerBus` | string | Yes | Bus that triggers ducking when playing |
| `targetBus` | string | Yes | Bus whose volume is reduced |
| `duckLevel` | number | No | Volume fraction during duck (0.3 = 30%) |
| `attackMs` | number | No | Ramp-down duration in ms |
| `releaseMs` | number | No | Ramp-up duration in ms |

**Example:**
```json
{
  "command": "set_ducking_rule",
  "params": {
    "triggerBus": "my_triggerBus",
    "targetBus": "my_targetBus"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `set_reverb_zone`

Configure reverb zone on entity

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Entity to attach reverb zone to |
| `shape` | `"box"` \| `"sphere"` | No | Box or Sphere |
| `sizeX` | number | No | Box width (X axis) |
| `sizeY` | number | No | Box height (Y axis) |
| `sizeZ` | number | No | Box depth (Z axis) |
| `radius` | number | No | Sphere radius |
| `reverbType` | `"hall"` \| `"room"` \| `"cave"` \| `"outdoor"` \| `"custom"` | No | Reverb preset type |
| `wetMix` | number | No | Wet/dry mix (0-1) |
| `decayTime` | number | No | Decay time in seconds |
| `preDelay` | number | No | Pre-delay in milliseconds |
| `priority` | number | No | Priority for overlapping zones |

**Example:**
```json
{
  "command": "set_reverb_zone",
  "params": {
    "entityId": "entity_1"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `remove_reverb_zone`

Remove reverb zone from entity

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Entity to remove reverb zone from |

**Example:**
```json
{
  "command": "remove_reverb_zone",
  "params": {
    "entityId": "entity_1"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `set_music_intensity`

Set adaptive music intensity level (0.0-1.0) to control stem layering

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `intensity` | number | Yes | Intensity level (0.0-1.0) |

**Example:**
```json
{
  "command": "set_music_intensity",
  "params": {
    "intensity": 1
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `set_music_stems`

Configure adaptive music stems (pad, bass, melody, drums) for dynamic layering

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `drums` | string | No | Asset ID for drums stem |
| `bass` | string | No | Asset ID for bass stem |
| `melody` | string | No | Asset ID for melody stem |
| `pad` | string | No | Asset ID for pad/ambient stem |
| `bpm` | number | No | Beats per minute for quantization |

**Example:**
```json
{
  "command": "set_music_stems",
  "params": {}
}
```

Scope: `scene:write` | Token cost: 0

---

### `set_adaptive_music`

Configure adaptive music track with stems (pad, bass, melody, drums) for dynamic layering

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `pad` | string | No | Asset ID for pad/ambient stem |
| `bass` | string | No | Asset ID for bass stem |
| `melody` | string | No | Asset ID for melody stem |
| `drums` | string | No | Asset ID for drums stem |
| `bpm` | number | No | Beats per minute for beat-quantized transitions |

**Example:**
```json
{
  "command": "set_adaptive_music",
  "params": {}
}
```

Scope: `scene:write` | Token cost: 0

---

### `transition_music_segment`

Transition to a named music segment with beat-quantized timing (horizontal re-sequencing)

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `segment` | string | Yes | Name of the music segment to transition to |
| `quantized` | boolean | No | Quantize transition to next beat (default: true) |

**Example:**
```json
{
  "command": "transition_music_segment",
  "params": {
    "segment": "my_segment"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `create_audio_snapshot`

Save a named snapshot of current audio state (bus volumes, stems, effects, ducking)

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | Yes | Name for the audio snapshot |

**Example:**
```json
{
  "command": "create_audio_snapshot",
  "params": {
    "name": "my_name"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `apply_audio_snapshot`

Crossfade to a previously saved audio snapshot

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | Yes | Name of the snapshot to apply |
| `crossfadeDurationMs` | number | No | Duration of crossfade in milliseconds (default: 1000) |

**Example:**
```json
{
  "command": "apply_audio_snapshot",
  "params": {
    "name": "my_name"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `set_audio_occlusion`

Enable or disable raycasting-based audio occlusion (low-pass filtering when geometry blocks listener)

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Entity ID to enable/disable occlusion for |
| `enabled` | boolean | Yes | Enable audio occlusion |

**Example:**
```json
{
  "command": "set_audio_occlusion",
  "params": {
    "entityId": "entity_1",
    "enabled": true
  }
}
```

Scope: `scene:write` | Token cost: 0

---

## Particles

### `set_particle`

Set or update particle effect on an entity. Creates a GPU particle emitter with configurable emission, velocity, color gradient, and rendering options.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Entity to attach particles to |
| `preset` | `"fire"` \| `"smoke"` \| `"sparks"` \| `"rain"` \| `"snow"` \| `"explosion"` \| `"magic_sparkle"` \| `"dust"` \| `"trail"` \| `"custom"` | No | Preset name (overrides all other fields) |
| `maxParticles` | integer | No | Max GPU particles (100-50000) |
| `lifetimeMin` | number | No | Min particle lifetime in seconds |
| `lifetimeMax` | number | No | Max particle lifetime in seconds |
| `velocityMin` | number[] | No | Min velocity [x, y, z] |
| `velocityMax` | number[] | No | Max velocity [x, y, z] |
| `acceleration` | number[] | No | Acceleration [x, y, z] (gravity = [0, -9.8, 0]) |
| `linearDrag` | number | No | Linear drag coefficient |
| `sizeStart` | number | No | Particle start size |
| `sizeEnd` | number | No | Particle end size |
| `blendMode` | `"additive"` \| `"alpha_blend"` \| `"premultiply"` | No | Blend mode |
| `orientation` | `"billboard"` \| `"velocity_aligned"` \| `"fixed"` | No | Particle orientation |
| `worldSpace` | boolean | No | Emit in world space (true) or local space (false) |

**Example:**
```json
{
  "command": "set_particle",
  "params": {
    "entityId": "entity_1"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `remove_particle`

Remove particle effect from an entity

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Entity to remove particles from |

**Example:**
```json
{
  "command": "remove_particle",
  "params": {
    "entityId": "entity_1"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `toggle_particle`

Enable or disable particle emission on an entity without removing configuration

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Target entity |
| `enabled` | boolean | Yes | Enable/disable emission |

**Example:**
```json
{
  "command": "toggle_particle",
  "params": {
    "entityId": "entity_1",
    "enabled": true
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `set_particle_preset`

Apply a named particle preset to an entity. Replaces all particle configuration with preset defaults. Presets: fire, smoke, sparks, rain, snow, explosion, magic_sparkle, dust, trail.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Target entity |
| `preset` | `"fire"` \| `"smoke"` \| `"sparks"` \| `"rain"` \| `"snow"` \| `"explosion"` \| `"magic_sparkle"` \| `"dust"` \| `"trail"` | Yes | Preset name |

**Example:**
```json
{
  "command": "set_particle_preset",
  "params": {
    "entityId": "entity_1",
    "preset": "fire"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `play_particle`

Start/resume particle emission on an entity

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Entity with particle component |

**Example:**
```json
{
  "command": "play_particle",
  "params": {
    "entityId": "entity_1"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `stop_particle`

Stop particle emission on an entity

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Entity with particle component |

**Example:**
```json
{
  "command": "stop_particle",
  "params": {
    "entityId": "entity_1"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `burst_particle`

Trigger an immediate burst of particles on an entity

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Entity with particle component |
| `count` | integer | No | Number of particles to emit (default: 100) |

**Example:**
```json
{
  "command": "burst_particle",
  "params": {
    "entityId": "entity_1"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `get_particle`

Get particle configuration for an entity

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Entity to query |

**Example:**
```json
{
  "command": "get_particle",
  "params": {
    "entityId": "entity_1"
  }
}
```

Scope: `scene:read` | Token cost: 0

---

## Animation

### `play_animation`

Play a named animation clip on an entity. Uses crossfade blending for smooth transitions between clips.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Entity with animation clips (glTF model) |
| `clipName` | string | Yes | Name of the animation clip to play |
| `crossfadeSecs` | number | No | Crossfade duration in seconds (default: 0.3) |

**Example:**
```json
{
  "command": "play_animation",
  "params": {
    "entityId": "entity_1",
    "clipName": "my_clipName"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `pause_animation`

Pause the currently playing animation on an entity

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Entity with playing animation |

**Example:**
```json
{
  "command": "pause_animation",
  "params": {
    "entityId": "entity_1"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `resume_animation`

Resume a paused animation on an entity

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Entity with paused animation |

**Example:**
```json
{
  "command": "resume_animation",
  "params": {
    "entityId": "entity_1"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `stop_animation`

Stop all animations on an entity and reset to bind pose

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Entity with playing animation |

**Example:**
```json
{
  "command": "stop_animation",
  "params": {
    "entityId": "entity_1"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `seek_animation`

Seek to a specific time in the current animation clip

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Entity with animation |
| `timeSecs` | number | Yes | Time to seek to in seconds |

**Example:**
```json
{
  "command": "seek_animation",
  "params": {
    "entityId": "entity_1",
    "timeSecs": 1
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `set_animation_speed`

Set the playback speed of animation on an entity

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Entity with animation |
| `speed` | number | Yes | Playback speed multiplier (1.0 = normal, 2.0 = double speed, 0.5 = half speed) |

**Example:**
```json
{
  "command": "set_animation_speed",
  "params": {
    "entityId": "entity_1",
    "speed": 1
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `set_animation_loop`

Enable or disable looping for the current animation on an entity

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Entity with animation |
| `looping` | boolean | Yes | Whether animation should loop |

**Example:**
```json
{
  "command": "set_animation_loop",
  "params": {
    "entityId": "entity_1",
    "looping": true
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `get_animation_state`

Get the current animation playback state for an entity, including active clip, speed, elapsed time, and loop status

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Entity to query |

**Example:**
```json
{
  "command": "get_animation_state",
  "params": {
    "entityId": "entity_1"
  }
}
```

Scope: `scene:read` | Token cost: 0

---

### `list_animations`

List all available animation clips on an entity. Returns clip names and durations.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Entity to query (must be a glTF model with animations) |

**Example:**
```json
{
  "command": "list_animations",
  "params": {
    "entityId": "entity_1"
  }
}
```

Scope: `scene:read` | Token cost: 0

---

### `set_animation_blend_weight`

Set the blend weight for a specific animation clip (0.0-1.0). Used to blend multiple animations together.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Entity with animation |
| `clipName` | string | Yes | Name of the clip to control |
| `weight` | number | Yes | Blend weight (0.0 = no influence, 1.0 = full influence) |

**Example:**
```json
{
  "command": "set_animation_blend_weight",
  "params": {
    "entityId": "entity_1",
    "clipName": "my_clipName",
    "weight": 1
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `set_clip_speed`

Set the playback speed for a specific animation clip

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Entity with animation |
| `clipName` | string | Yes | Name of the clip to control |
| `speed` | number | Yes | Playback speed multiplier (1.0 = normal, 2.0 = double speed) |

**Example:**
```json
{
  "command": "set_clip_speed",
  "params": {
    "entityId": "entity_1",
    "clipName": "my_clipName",
    "speed": 1
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `get_animation_graph`

Get the animation graph state showing all node weights and speeds for an entity

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Entity to query |

**Example:**
```json
{
  "command": "get_animation_graph",
  "params": {
    "entityId": "entity_1"
  }
}
```

Scope: `scene:read` | Token cost: 0

---

### `create_animation_clip`

Create a keyframe animation clip on an entity. The clip can animate transform, material, and light properties over time with user-defined keyframes.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Target entity ID |
| `duration` | number | No | Clip duration in seconds (default 2.0) |
| `playMode` | `"once"` \| `"loop"` \| `"ping_pong"` | No | Playback mode (default loop) |
| `speed` | number | No | Playback speed multiplier (default 1.0) |
| `autoplay` | boolean | No | Auto-play when entering Play mode (default true) |

**Example:**
```json
{
  "command": "create_animation_clip",
  "params": {
    "entityId": "entity_1"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `add_clip_keyframe`

Add a keyframe to a property animation track. Creates the track if it does not exist.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes |  |
| `target` | string | Yes | Property target (e.g. position_x, material_metallic, light_intensity) |
| `time` | number | Yes | Keyframe time in seconds |
| `value` | number | Yes | Property value at this keyframe |
| `interpolation` | `"step"` \| `"linear"` \| `"ease_in"` \| `"ease_out"` \| `"ease_in_out"` | No | Interpolation mode (default linear) |

**Example:**
```json
{
  "command": "add_clip_keyframe",
  "params": {
    "entityId": "entity_1",
    "target": "my_target",
    "time": 1,
    "value": 1
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `remove_clip_keyframe`

Remove a keyframe from a property animation track by target and time

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes |  |
| `target` | string | Yes | Property target |
| `time` | number | Yes | Keyframe time to remove |

**Example:**
```json
{
  "command": "remove_clip_keyframe",
  "params": {
    "entityId": "entity_1",
    "target": "my_target",
    "time": 1
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `update_clip_keyframe`

Update an existing keyframe's value, interpolation, or time

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes |  |
| `target` | string | Yes |  |
| `time` | number | Yes | Current keyframe time (for lookup) |
| `value` | number | No | New value (optional) |
| `interpolation` | `"step"` \| `"linear"` \| `"ease_in"` \| `"ease_out"` \| `"ease_in_out"` | No |  |
| `newTime` | number | No | Move keyframe to new time (optional) |

**Example:**
```json
{
  "command": "update_clip_keyframe",
  "params": {
    "entityId": "entity_1",
    "target": "my_target",
    "time": 1
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `set_clip_property`

Update animation clip properties like duration, play mode, speed, or autoplay

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes |  |
| `duration` | number | No |  |
| `playMode` | `"once"` \| `"loop"` \| `"ping_pong"` | No |  |
| `speed` | number | No |  |
| `autoplay` | boolean | No |  |

**Example:**
```json
{
  "command": "set_clip_property",
  "params": {
    "entityId": "entity_1"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `preview_clip`

Start, stop, or seek the animation clip preview in Edit mode

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes |  |
| `action` | `"play"` \| `"stop"` \| `"seek"` | Yes |  |
| `seekTime` | number | No | Time to seek to (when action=seek) |

**Example:**
```json
{
  "command": "preview_clip",
  "params": {
    "entityId": "entity_1",
    "action": "play"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `get_animation_clip`

Get the keyframe animation clip data for an entity, including all tracks and keyframes

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes |  |

**Example:**
```json
{
  "command": "get_animation_clip",
  "params": {
    "entityId": "entity_1"
  }
}
```

Scope: `scene:read` | Token cost: 0

---

### `remove_animation_clip`

Remove the keyframe animation clip from an entity

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes |  |

**Example:**
```json
{
  "command": "remove_animation_clip",
  "params": {
    "entityId": "entity_1"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

## Mesh

### `csg_union`

Combine two mesh entities using CSG union (boolean add)

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityIdA` | string | Yes | Entity ID of first mesh (A) |
| `entityIdB` | string | Yes | Entity ID of second mesh (B) |
| `deleteSources` | boolean | No | Delete source entities after operation (default: true) |
| `name` | string | No | Name for result entity (auto-generated if omitted) |

**Example:**
```json
{
  "command": "csg_union",
  "params": {
    "entityIdA": "my_entityIdA",
    "entityIdB": "my_entityIdB"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `csg_subtract`

Subtract mesh B from mesh A using CSG boolean subtraction

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityIdA` | string | Yes | Entity ID of first mesh (A) |
| `entityIdB` | string | Yes | Entity ID of second mesh (B) |
| `deleteSources` | boolean | No | Delete source entities after operation (default: true) |
| `name` | string | No | Name for result entity (auto-generated if omitted) |

**Example:**
```json
{
  "command": "csg_subtract",
  "params": {
    "entityIdA": "my_entityIdA",
    "entityIdB": "my_entityIdB"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `csg_intersect`

Compute the intersection of two mesh entities using CSG boolean intersection

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityIdA` | string | Yes | Entity ID of first mesh (A) |
| `entityIdB` | string | Yes | Entity ID of second mesh (B) |
| `deleteSources` | boolean | No | Delete source entities after operation (default: true) |
| `name` | string | No | Name for result entity (auto-generated if omitted) |

**Example:**
```json
{
  "command": "csg_intersect",
  "params": {
    "entityIdA": "my_entityIdA",
    "entityIdB": "my_entityIdB"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `extrude_shape`

Create a 3D mesh by extruding a 2D cross-section along a path

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `shape` | `"circle"` \| `"square"` \| `"hexagon"` \| `"star"` | Yes | Cross-section shape: circle, square, hexagon, or star |
| `radius` | number | No | Radius of the cross-section (for circle, hexagon, star outer). Default: 0.5 |
| `length` | number | No | Length of extrusion along Y-axis. Default: 2.0 |
| `segments` | integer | No | Number of segments for circular shapes. Default: 16 |
| `innerRadius` | number | No | Inner radius for star shape. Default: 0.25 |
| `starPoints` | integer | No | Number of points for star shape. Default: 5 |
| `size` | number | No | Side length for square shape. Default: 1.0 |
| `name` | string | No | Name for the result entity |
| `position` | number[3] | No | World position [x, y, z] |

**Example:**
```json
{
  "command": "extrude_shape",
  "params": {
    "shape": "circle"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `lathe_shape`

Create a 3D mesh by revolving a 2D profile around the Y-axis

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `profile` | array[] | Yes | Array of [radius, height] points defining the 2D profile |
| `segments` | integer | No | Number of rotational segments (8-64). Default: 32 |
| `name` | string | No | Name for the result entity |
| `position` | number[3] | No | World position [x, y, z] |

**Example:**
```json
{
  "command": "lathe_shape",
  "params": {
    "profile": []
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `array_entity`

Duplicate an entity in a grid (NxMxK) or circular pattern

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Entity ID to duplicate |
| `pattern` | `"grid"` \| `"circle"` | Yes | Array pattern: grid or circle |
| `countX` | integer | No | Grid count along X axis. Default: 3 |
| `countY` | integer | No | Grid count along Y axis. Default: 1 |
| `countZ` | integer | No | Grid count along Z axis. Default: 3 |
| `spacingX` | number | No | Grid spacing along X. Default: 2.0 |
| `spacingY` | number | No | Grid spacing along Y. Default: 2.0 |
| `spacingZ` | number | No | Grid spacing along Z. Default: 2.0 |
| `circleCount` | integer | No | Number of copies in circle pattern. Default: 8 |
| `circleRadius` | number | No | Radius of circle pattern. Default: 5.0 |

**Example:**
```json
{
  "command": "array_entity",
  "params": {
    "entityId": "entity_1",
    "pattern": "grid"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `combine_meshes`

Merge multiple mesh entities into a single entity

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityIds` | string[] | Yes | Array of entity IDs to merge |
| `deleteSources` | boolean | No | Delete source entities after combining. Default: true |
| `name` | string | No | Name for the combined entity |

**Example:**
```json
{
  "command": "combine_meshes",
  "params": {
    "entityIds": [
      "entity_1"
    ]
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `mesh_inset`

Inset selected mesh faces inward by a specified amount (edit mode)

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `indices` | number[] | No | Face indices to inset (all selected faces if omitted) |
| `amount` | number | No | Inset distance (default: 0.1) |

**Example:**
```json
{
  "command": "mesh_inset",
  "params": {}
}
```

Scope: `scene:write` | Token cost: 0

---

### `mesh_bevel`

Bevel selected mesh edges with specified width and segment count (edit mode)

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `indices` | number[] | No | Edge indices to bevel (all selected edges if omitted) |
| `width` | number | No | Bevel width (default: 0.1) |
| `segments` | number | No | Number of bevel segments (default: 1) |

**Example:**
```json
{
  "command": "mesh_bevel",
  "params": {}
}
```

Scope: `scene:write` | Token cost: 0

---

### `mesh_loop_cut`

Add loop cuts (subdivisions) along a mesh edge (edit mode)

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `edgeIndex` | number | Yes | Edge index to cut along |
| `cuts` | number | No | Number of cuts (default: 1) |

**Example:**
```json
{
  "command": "mesh_loop_cut",
  "params": {
    "edgeIndex": 1
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `mesh_delete`

Delete selected mesh elements by mode: face, edge, or vertex (edit mode)

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `indices` | number[] | No | Element indices to delete (all selected if omitted) |
| `mode` | `"face"` \| `"edge"` \| `"vertex"` | No | Deletion mode (default: face) |

**Example:**
```json
{
  "command": "mesh_delete",
  "params": {}
}
```

Scope: `scene:write` | Token cost: 0

---

## Terrain

### `spawn_terrain`

Spawn a procedural terrain entity with noise-based heightmap

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | No | Display name for the terrain entity |
| `position` | number[3] | No | World position [x, y, z] |
| `noiseType` | `"perlin"` \| `"simplex"` \| `"value"` | No | Noise algorithm |
| `octaves` | integer | No | Number of noise octaves |
| `frequency` | number | No | Base noise frequency |
| `amplitude` | number | No | Noise amplitude (persistence) |
| `heightScale` | number | No | Overall height multiplier |
| `seed` | integer | No | Random seed |
| `resolution` | `"32"` \| `"64"` \| `"128"` \| `"256"` | No | Grid vertices per side |
| `size` | number | No | World-space width/depth |

**Example:**
```json
{
  "command": "spawn_terrain",
  "params": {}
}
```

Scope: `scene:write` | Token cost: 0

---

### `update_terrain`

Update terrain noise parameters and regenerate the heightmap mesh

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Entity ID of the terrain |
| `noiseType` | `"perlin"` \| `"simplex"` \| `"value"` | No |  |
| `octaves` | integer | No |  |
| `frequency` | number | No |  |
| `amplitude` | number | No |  |
| `heightScale` | number | No |  |
| `seed` | integer | No |  |
| `resolution` | `"32"` \| `"64"` \| `"128"` \| `"256"` | No |  |
| `size` | number | No |  |

**Example:**
```json
{
  "command": "update_terrain",
  "params": {
    "entityId": "entity_1"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `sculpt_terrain`

Modify terrain heightmap at a specific position with a brush

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Entity ID of the terrain |
| `position` | number[2] | Yes | Sculpt center [x, z] in WORLD space — the engine subtracts the terrain entity's transform to find the brush cell, so an offset terrain sculpts where you clicked, not where it would have been at the origin |
| `radius` | number | Yes | Brush radius in world units |
| `strength` | number | Yes | Brush strength (positive=raise, negative=lower) |

**Example:**
```json
{
  "command": "sculpt_terrain",
  "params": {
    "entityId": "entity_1",
    "position": [],
    "radius": 1,
    "strength": 1
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `get_terrain`

Get terrain noise parameters for an entity

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Entity ID of the terrain |

**Example:**
```json
{
  "command": "get_terrain",
  "params": {
    "entityId": "entity_1"
  }
}
```

Scope: `scene:read` | Token cost: 0

---

## Export

### `export_game`

Export the current scene as a standalone HTML game file

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `title` | string | No | Game title (defaults to scene name) |
| `mode` | `"single-html"` \| `"zip"` | No | Export mode (default: single-html) |
| `resolution` | string | No | Canvas resolution: 'responsive', '1920x1080', '1280x720' (default: responsive) |

**Example:**
```json
{
  "command": "export_game",
  "params": {}
}
```

Scope: `scene:read` | Token cost: 0

---

### `get_export_status`

Check if an export operation is currently in progress

**Example:**
```json
{
  "command": "get_export_status",
  "params": {}
}
```

Scope: `scene:read` | Token cost: 0

---

### `export_project_zip`

Export game as ZIP bundle with separated assets (textures, audio, models)

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `title` | string | No | Game title (defaults to scene name) |
| `preset` | `"web-optimized"` \| `"self-contained"` \| `"itch-io"` \| `"newgrounds"` \| `"pwa-mobile"` \| `"debug"` | No | Export preset with optimized settings for target platform |

**Example:**
```json
{
  "command": "export_project_zip",
  "params": {}
}
```

Scope: `scene:read` | Token cost: 0

---

### `export_project_pwa`

Export game as Progressive Web App (installable on mobile/desktop)

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `title` | string | No | Game title (defaults to scene name) |
| `preset` | `"web-optimized"` \| `"self-contained"` \| `"itch-io"` \| `"newgrounds"` \| `"pwa-mobile"` \| `"debug"` | No | Export preset (defaults to pwa-mobile) |

**Example:**
```json
{
  "command": "export_project_pwa",
  "params": {}
}
```

Scope: `scene:read` | Token cost: 0

---

### `set_loading_screen`

Customize the loading screen appearance for exported games

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `backgroundColor` | string | No | Background color (hex format, e.g. '#1a1a1a') |
| `progressBarColor` | string | No | Progress indicator color (hex format, e.g. '#6366f1') |
| `progressStyle` | `"bar"` \| `"spinner"` \| `"dots"` \| `"none"` | No | Loading animation style |
| `title` | string | No | Loading screen title text (optional) |
| `subtitle` | string | No | Loading screen subtitle text (optional) |

**Example:**
```json
{
  "command": "set_loading_screen",
  "params": {}
}
```

Scope: `scene:write` | Token cost: 0

---

### `set_export_preset`

Select an export preset for future exports

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `preset` | `"web-optimized"` \| `"self-contained"` \| `"itch-io"` \| `"newgrounds"` \| `"pwa-mobile"` \| `"debug"` | Yes | Export preset name |

**Example:**
```json
{
  "command": "set_export_preset",
  "params": {
    "preset": "web-optimized"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

## Documentation

### `search_docs`

Search SpawnForge documentation by keyword. Returns ranked results with snippets.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | Yes | Search query (keywords or natural language question) |
| `maxResults` | number | No | Maximum results to return (default: 10) |

**Example:**
```json
{
  "command": "search_docs",
  "params": {
    "query": "my_query"
  }
}
```

Scope: `docs:read` | Token cost: 0

---

### `get_doc`

Retrieve a full documentation page by its path (e.g., 'features/physics')

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `path` | string | Yes | Document path relative to docs/ without .md extension (e.g., 'features/physics') |

**Example:**
```json
{
  "command": "get_doc",
  "params": {
    "path": "my_path"
  }
}
```

Scope: `docs:read` | Token cost: 0

---

### `list_doc_topics`

List all available documentation topics with descriptions and tags

**Example:**
```json
{
  "command": "list_doc_topics",
  "params": {}
}
```

Scope: `docs:read` | Token cost: 0

---

## Shaders

### `register_custom_shader`

Register a named WGSL function body into one of the 8 mega-shader slots (0-7). The function receives (color: vec4<f32>, uv: vec2<f32>, time: f32, params: array<f32, 16>) and must return vec4<f32>. The slot is activated per-entity via apply_custom_shader. Triggers shader hot-reload on all entities using that slot.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `slot` | number | Yes | Slot index 0-7 (0-based) |
| `name` | string | Yes | Human-readable name for this shader slot |
| `wgslCode` | string | Yes | WGSL function body. Must return vec4<f32>. Do NOT include fn signature, @group/@binding, or entry-point declarations. |
| `paramNames` | string[] | No | Optional parameter name hints (up to 16 values) |

**Example:**
```json
{
  "command": "register_custom_shader",
  "params": {
    "slot": 1,
    "name": "my_name",
    "wgslCode": "my_wgslCode"
  }
}
```

Scope: `shaders:write` | Token cost: 1

---

### `apply_custom_shader`

Apply a registered mega-shader slot (1-8, 1-indexed) to an entity, optionally passing float parameter values. The entity must have a mesh. Slot must have been registered with register_custom_shader first.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Target entity ID |
| `slot` | number | Yes | Slot number 1-8 (1-indexed, matches the WGSL dispatch case) |
| `params` | object | No | Optional named float parameters (up to 16 values) |

**Example:**
```json
{
  "command": "apply_custom_shader",
  "params": {
    "entityId": "entity_1",
    "slot": 1
  }
}
```

Scope: `shaders:write` | Token cost: 1

---

### `remove_custom_shader_slot`

Remove a registered shader slot (0-7, 0-based) from the mega-shader registry. Entities that were using this slot will fall back to passthrough. Triggers shader hot-reload.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `slot` | number | Yes | Slot index 0-7 to clear |

**Example:**
```json
{
  "command": "remove_custom_shader_slot",
  "params": {
    "slot": 1
  }
}
```

Scope: `shaders:write` | Token cost: 0

---

### `create_shader_graph`

Create a new shader graph for visual shader authoring

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | No | Name of the shader graph |

**Example:**
```json
{
  "command": "create_shader_graph",
  "params": {}
}
```

Scope: `shaders:write` | Token cost: 0

---

### `add_shader_node`

Add a node to a shader graph

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `graphId` | string | No | Shader graph ID (uses active graph if omitted) |
| `nodeType` | `"vertex_position"` \| `"vertex_normal"` \| `"vertex_uv"` \| `"time"` \| `"camera_position"` \| `"add"` \| `"subtract"` \| `"multiply"` \| `"divide"` \| `"power"` \| `"sqrt"` \| `"abs"` \| `"clamp"` \| `"lerp"` \| `"step"` \| `"smoothstep"` \| `"sin"` \| `"cos"` \| `"fract"` \| `"floor"` \| `"texture_sample"` \| `"noise_texture"` \| `"voronoi_texture"` \| `"color_constant"` \| `"hsv_to_rgb"` \| `"rgb_to_hsv"` \| `"color_ramp"` \| `"split_vec3"` \| `"combine_vec3"` \| `"normalize"` \| `"dot_product"` \| `"cross_product"` \| `"fresnel"` \| `"normal_map"` \| `"pbr_output"` | Yes | Type of shader node to add |
| `position` | object | No | Position in the graph canvas |
| `data` | object | No | Node-specific data (e.g., color value for color_constant) |

**Example:**
```json
{
  "command": "add_shader_node",
  "params": {
    "nodeType": "vertex_position"
  }
}
```

Scope: `shaders:write` | Token cost: 0

---

### `connect_shader_nodes`

Connect two shader nodes together

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sourceNodeId` | string | Yes | Source node ID |
| `sourceHandle` | string | Yes | Source output handle name |
| `targetNodeId` | string | Yes | Target node ID |
| `targetHandle` | string | Yes | Target input handle name |

**Example:**
```json
{
  "command": "connect_shader_nodes",
  "params": {
    "sourceNodeId": "my_sourceNodeId",
    "sourceHandle": "my_sourceHandle",
    "targetNodeId": "my_targetNodeId",
    "targetHandle": "my_targetHandle"
  }
}
```

Scope: `shaders:write` | Token cost: 0

---

### `compile_shader`

Compile a shader graph to WGSL code

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `graphId` | string | No | Shader graph ID (uses active graph if omitted) |

**Example:**
```json
{
  "command": "compile_shader",
  "params": {}
}
```

Scope: `shaders:read` | Token cost: 0

---

### `apply_shader_to_entity`

Apply a compiled shader graph to an entity's material

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Entity ID to apply shader to |
| `graphId` | string | No | Shader graph ID (uses active graph if omitted) |

**Example:**
```json
{
  "command": "apply_shader_to_entity",
  "params": {
    "entityId": "entity_1"
  }
}
```

Scope: `shaders:write` | Token cost: 0

---

### `remove_shader_from_entity`

Remove the custom shader effect from an entity, restoring its default material rendering.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Entity ID to remove the shader from |

**Example:**
```json
{
  "command": "remove_shader_from_entity",
  "params": {
    "entityId": "entity_1"
  }
}
```

Scope: `shaders:write` | Token cost: 0

---

### `list_shader_presets`

List all saved shader graphs

**Example:**
```json
{
  "command": "list_shader_presets",
  "params": {}
}
```

Scope: `shaders:read` | Token cost: 0

---

## Prefab

### `save_as_prefab`

Save the current entity as a reusable prefab template

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Entity to save as prefab |
| `name` | string | Yes | Name for the prefab |
| `category` | string | No | Category (e.g. Characters, Props, Effects) |
| `description` | string | No | Optional description |

**Example:**
```json
{
  "command": "save_as_prefab",
  "params": {
    "entityId": "entity_1",
    "name": "my_name"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `instantiate_prefab`

Spawn a copy of a saved prefab at a position

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `prefabId` | string | Yes | Prefab ID or name |
| `position` | number[] | No | [x, y, z] spawn position |
| `name` | string | No | Optional name override for the spawned entity |

**Example:**
```json
{
  "command": "instantiate_prefab",
  "params": {
    "prefabId": "my_prefabId"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `list_prefabs`

List all available prefabs (built-in and user-created)

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `category` | string | No | Optional category filter |

**Example:**
```json
{
  "command": "list_prefabs",
  "params": {}
}
```

Scope: `scene:read` | Token cost: 0

---

### `delete_prefab`

Delete a user-created prefab

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `prefabId` | string | Yes | Prefab ID to delete |

**Example:**
```json
{
  "command": "delete_prefab",
  "params": {
    "prefabId": "my_prefabId"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `get_prefab`

Get full prefab data by ID or name

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `prefabId` | string | Yes | Prefab ID or name |

**Example:**
```json
{
  "command": "get_prefab",
  "params": {
    "prefabId": "my_prefabId"
  }
}
```

Scope: `scene:read` | Token cost: 0

---

## Game_components

### `add_game_component`

Add a pre-built game component (e.g., CharacterController, Health, Collectible) to an entity

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Target entity ID |
| `componentType` | `"character_controller"` \| `"health"` \| `"collectible"` \| `"damage_zone"` \| `"checkpoint"` \| `"teleporter"` \| `"moving_platform"` \| `"trigger_zone"` \| `"spawner"` \| `"follower"` \| `"projectile"` \| `"win_condition"` | Yes | Type of game component to add |
| `properties` | object | No | Optional property overrides (uses defaults if omitted) |

**Example:**
```json
{
  "command": "add_game_component",
  "params": {
    "entityId": "entity_1",
    "componentType": "character_controller"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `update_game_component`

Update properties of an existing game component

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Target entity ID |
| `componentType` | `"character_controller"` \| `"health"` \| `"collectible"` \| `"damage_zone"` \| `"checkpoint"` \| `"teleporter"` \| `"moving_platform"` \| `"trigger_zone"` \| `"spawner"` \| `"follower"` \| `"projectile"` \| `"win_condition"` | Yes | Type of game component to update |
| `properties` | object | Yes | Property values to update |

**Example:**
```json
{
  "command": "update_game_component",
  "params": {
    "entityId": "entity_1",
    "componentType": "character_controller"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `remove_game_component`

Remove a game component from an entity

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Target entity ID |
| `componentName` | `"character_controller"` \| `"health"` \| `"collectible"` \| `"damage_zone"` \| `"checkpoint"` \| `"teleporter"` \| `"moving_platform"` \| `"trigger_zone"` \| `"spawner"` \| `"follower"` \| `"projectile"` \| `"win_condition"` | Yes | Name of component to remove |

**Example:**
```json
{
  "command": "remove_game_component",
  "params": {
    "entityId": "entity_1",
    "componentName": "character_controller"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `get_game_components`

Get all game components on an entity

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Entity ID to query |

**Example:**
```json
{
  "command": "get_game_components",
  "params": {
    "entityId": "entity_1"
  }
}
```

Scope: `scene:read` | Token cost: 0

---

### `list_game_component_types`

List all available game component types with defaults

**Example:**
```json
{
  "command": "list_game_component_types",
  "params": {}
}
```

Scope: `scene:read` | Token cost: 0

---

## Game_cameras

### `set_game_camera`

Set or update game camera configuration on an entity

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Entity ID to configure camera on |
| `mode` | `"thirdPersonFollow"` \| `"firstPerson"` \| `"sideScroller"` \| `"topDown"` \| `"fixed"` \| `"orbital"` | Yes | Camera mode. Selects which of the parameters below apply; every parameter is optional and an omitted one takes the engine's default for that mode |
| `targetEntity` | string | No | Entity ID to follow/track (optional) |
| `offset` | number[] | No | Camera offset from target as [x, y, z] (thirdPersonFollow, default [0, 2, -5]) |
| `damping` | number | No | Movement smoothing (thirdPersonFollow / sideScroller / topDown, default 5) |
| `minDistance` | number | No | Closest the camera may sit to its target (thirdPersonFollow, default 2) |
| `maxDistance` | number | No | Furthest the camera may sit from its target; must not be below minDistance (thirdPersonFollow, default 10) |
| `lookAtTarget` | boolean | No | Aim the camera at its target rather than holding a fixed rotation (thirdPersonFollow, default true) |
| `collisionAvoidance` | boolean | No | Pull the camera in when geometry blocks the shot (thirdPersonFollow, default true) |
| `eyeHeight` | number | No | Eye height above the entity origin (firstPerson, default 1.7) |
| `mouseSensitivity` | number | No | Mouse look sensitivity (firstPerson, default 0.1) |
| `fov` | number | No | Vertical field of view in degrees (firstPerson, default 75) |
| `pitchClamp` | number[] | No | Pitch limits as [min, max] degrees, min <= max (firstPerson, default [-89, 89]) |
| `zOffset` | number | No | Distance from the play plane (sideScroller, default 10) |
| `followY` | boolean | No | Track the target vertically as well as horizontally (sideScroller, default true) |
| `yBounds` | number[] | No | Vertical travel limits as [min, max], min <= max (sideScroller, unbounded when omitted) |
| `height` | number | No | Height above the target (topDown, default 15) |
| `followRotation` | boolean | No | Rotate with the target instead of holding world axes (topDown, default false) |
| `lookAt` | number[] | No | World point the camera aims at as [x, y, z] (fixed; holds its current rotation when omitted) |
| `radius` | number | No | Orbit radius (orbital, default 8) |
| `autoRotate` | boolean | No | Orbit continuously without input (orbital, default true) |
| `autoRotateSpeed` | number | No | Auto-rotation speed in degrees per second (orbital, default 15) |

**Example:**
```json
{
  "command": "set_game_camera",
  "params": {
    "entityId": "entity_1",
    "mode": "thirdPersonFollow"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `set_active_game_camera`

Set which entity is the active game camera for play mode

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Entity ID to make active camera (or null to clear) |

**Example:**
```json
{
  "command": "set_active_game_camera",
  "params": {
    "entityId": "entity_1"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `camera_shake`

Trigger a camera shake effect on the active game camera

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Entity ID of the game camera |
| `intensity` | number | Yes | Shake intensity (0.0-1.0) |
| `duration` | number | Yes | Shake duration in seconds |

**Example:**
```json
{
  "command": "camera_shake",
  "params": {
    "entityId": "entity_1",
    "intensity": 1,
    "duration": 1
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `get_game_camera`

Get game camera configuration for an entity

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Entity ID to query |

**Example:**
```json
{
  "command": "get_game_camera",
  "params": {
    "entityId": "entity_1"
  }
}
```

Scope: `scene:read` | Token cost: 0

---

## Generation

### `generate_3d_model`

Generate a 3D model from a text description using AI

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `prompt` | string | Yes | Description of the 3D model to generate |
| `quality` | `"standard"` \| `"high"` | No | Generation quality |
| `artStyle` | `"realistic"` \| `"cartoon"` \| `"low-poly"` \| `"pbr"` | No | Art style |
| `negativePrompt` | string | No | What to avoid in generation |
| `autoPlace` | boolean | No | Automatically place the generated model in the scene when complete (default true) |
| `targetEntityId` | string | No | Entity ID to associate the generated model with |
| `entityId` | string | No | Entity ID to associate the generated model with (alias for targetEntityId) |

**Example:**
```json
{
  "command": "generate_3d_model",
  "params": {
    "prompt": "my_prompt"
  }
}
```

Scope: `generation:write` | Token cost: 100

---

### `generate_3d_from_image`

Generate a 3D model from a reference image

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `imageBase64` | string | Yes | Base64-encoded image data |
| `prompt` | string | No | Optional text description |
| `entityId` | string | No | Entity ID to replace with the generated model |
| `targetEntityId` | string | No | Entity ID to replace with the generated model (takes precedence over entityId) |
| `autoPlace` | boolean | No | Automatically place the generated model in the scene when complete (default true) |

**Example:**
```json
{
  "command": "generate_3d_from_image",
  "params": {
    "imageBase64": "my_imageBase64"
  }
}
```

Scope: `generation:write` | Token cost: 150

---

### `generate_texture`

Generate a PBR texture set from text and apply to entity

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `prompt` | string | Yes | Description of the texture |
| `entityId` | string | No | Entity to apply textures to |
| `resolution` | `"1024"` \| `"2048"` | No | Texture resolution |
| `style` | `"realistic"` \| `"stylized"` \| `"cartoon"` | No | Texture style |
| `tiling` | boolean | No | Generate seamless tiling textures |
| `autoPlace` | boolean | No | Automatically apply the texture to the target entity when complete (default true when entityId is set) |
| `materialSlot` | `"base_color"` \| `"normal_map"` \| `"metallic_roughness"` \| `"emissive"` \| `"occlusion"` | No | Specific material slot to apply the texture to (applies all slots when omitted) |
| `targetEntityId` | string | No | Canonical alias for entityId; takes precedence when both are set |

**Example:**
```json
{
  "command": "generate_texture",
  "params": {
    "prompt": "my_prompt"
  }
}
```

Scope: `generation:write` | Token cost: 80

---

### `generate_pbr_maps`

Generate specific PBR texture maps for an entity

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `prompt` | string | Yes | Description of the surface |
| `entityId` | string | No | Entity to apply maps to |
| `targetEntityId` | string | No | Canonical alias for entityId; takes precedence when both are set |
| `maps` | string[] | No | Which PBR maps to generate |

**Example:**
```json
{
  "command": "generate_pbr_maps",
  "params": {
    "prompt": "my_prompt"
  }
}
```

Scope: `generation:write` | Token cost: 60

---

### `generate_sfx`

Generate a sound effect from text description

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `prompt` | string | Yes | Description of the sound effect |
| `durationSeconds` | number | No | Duration (0.5-22, default 5) |
| `entityId` | string | No | Optional: auto-attach to entity audio |

**Example:**
```json
{
  "command": "generate_sfx",
  "params": {
    "prompt": "my_prompt"
  }
}
```

Scope: `generation:write` | Token cost: 50

---

### `generate_voice`

Generate speech from text for NPC dialogue

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `text` | string | Yes | Dialogue text to speak |
| `voiceStyle` | `"neutral"` \| `"friendly"` \| `"sinister"` \| `"excited"` \| `"calm"` | No | Voice style |
| `entityId` | string | No | Optional: auto-attach to entity audio |
| `speaker` | string | No | Named speaker/character voice preset, blended into voiceStyle |

**Example:**
```json
{
  "command": "generate_voice",
  "params": {
    "text": "my_text"
  }
}
```

Scope: `generation:write` | Token cost: 40

---

### `generate_skybox`

Generate a custom skybox from text description

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `prompt` | string | Yes | Description of the environment/sky |
| `style` | `"realistic"` \| `"fantasy"` \| `"sci-fi"` \| `"cartoon"` | No | Visual style |

**Example:**
```json
{
  "command": "generate_skybox",
  "params": {
    "prompt": "my_prompt"
  }
}
```

Scope: `generation:write` | Token cost: 70

---

### `generate_music`

Generate background music from text description. Not available yet: the music provider is being replaced (#9522), so this command is withheld from AI tool sets and refused by the route until then.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `prompt` | string | Yes | Description of music (genre, mood, tempo) |
| `durationSeconds` | number | No | Duration (15-120, default 30) |
| `instrumental` | boolean | No | Instrumental only, no vocals (default true) |
| `entityId` | string | No | Optional: auto-attach to entity audio |
| `autoPlace` | boolean | No | Automatically attach the generated music to the target entity when complete (default true when entityId/targetEntityId is set) |
| `targetEntityId` | string | No | Entity ID to attach the generated music to (takes precedence over entityId) |

**Example:**
```json
{
  "command": "generate_music",
  "params": {
    "prompt": "my_prompt"
  }
}
```

Scope: `generation:write` | Token cost: 100

---

### `generate_sprite`

Generate a sprite image from a text prompt using AI

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `prompt` | string | Yes | Description of the sprite to generate |
| `style` | `"pixel-art"` \| `"hand-drawn"` \| `"vector"` \| `"realistic"` | No | Art style preset |
| `size` | `"32x32"` \| `"64x64"` \| `"128x128"` \| `"256x256"` \| `"512x512"` \| `"1024x1024"` | No | Sprite dimensions |
| `removeBackground` | boolean | No | Remove background after generation |
| `entityId` | string | No | Entity ID to attach the sprite to |
| `targetEntityId` | string | No | Entity ID to attach the sprite to (takes precedence over entityId) |
| `autoPlace` | boolean | No | Automatically attach the generated sprite to the target entity when complete (default true when entityId/targetEntityId is set) |

**Example:**
```json
{
  "command": "generate_sprite",
  "params": {
    "prompt": "my_prompt"
  }
}
```

Scope: `generation:write` | Token cost: 15

---

### `generate_sprite_sheet`

Generate animated sprite sheet from a source sprite

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sourceAssetId` | string | Yes | Asset ID of reference sprite |
| `frameCount` | number | No | Number of animation frames (2-8) |
| `style` | `"pixel-art"` \| `"hand-drawn"` \| `"vector"` \| `"realistic"` | No | Art style preset |
| `size` | `"32x32"` \| `"64x64"` \| `"128x128"` \| `"256x256"` | No | Frame dimensions |

**Example:**
```json
{
  "command": "generate_sprite_sheet",
  "params": {
    "sourceAssetId": "my_sourceAssetId"
  }
}
```

Scope: `generation:write` | Token cost: 60

---

### `generate_character`

Generate character with multiple poses

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `prompt` | string | Yes | Character description |
| `poses` | string[] | Yes | Poses to generate |
| `style` | `"pixel-art"` \| `"hand-drawn"` \| `"vector"` \| `"realistic"` | No | Art style preset |
| `size` | string | No | Sprite size, e.g. 128x128 (default 128x128) |

**Example:**
```json
{
  "command": "generate_character",
  "params": {
    "prompt": "my_prompt",
    "poses": [
      "entity_1"
    ]
  }
}
```

Scope: `generation:write` | Token cost: 80

---

### `generate_tileset`

Generate a complete tileset grid

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `prompt` | string | Yes | Tileset description (e.g., 'grass terrain') |
| `tileSize` | `"16"` \| `"32"` \| `"48"` \| `"64"` | No | Individual tile size in pixels |
| `gridSize` | `"4x4"` \| `"8x8"` \| `"16x16"` | No | Tileset grid dimensions |

**Example:**
```json
{
  "command": "generate_tileset",
  "params": {
    "prompt": "my_prompt"
  }
}
```

Scope: `generation:write` | Token cost: 50

---

### `remove_background`

Remove background from a sprite image

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `assetId` | string | Yes | Asset ID of sprite to process |

**Example:**
```json
{
  "command": "remove_background",
  "params": {
    "assetId": "my_assetId"
  }
}
```

Scope: `generation:write` | Token cost: 5

---

### `apply_style_transfer`

Apply a different art style to an existing sprite

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `assetId` | string | Yes | Source sprite asset ID |
| `targetStyle` | `"pixel-art"` \| `"hand-drawn"` \| `"vector"` \| `"realistic"` | Yes | Target art style |

**Example:**
```json
{
  "command": "apply_style_transfer",
  "params": {
    "assetId": "my_assetId",
    "targetStyle": "pixel-art"
  }
}
```

Scope: `generation:write` | Token cost: 10

---

### `set_project_style`

Set the default art style for all future sprite generations

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `preset` | `"pixel-art"` \| `"hand-drawn"` \| `"vector"` \| `"realistic"` | Yes | Style preset |

**Example:**
```json
{
  "command": "set_project_style",
  "params": {
    "preset": "pixel-art"
  }
}
```

Scope: `generation:write` | Token cost: 0

---

### `get_sprite_generation_status`

Check the status of a pending sprite generation job

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `jobId` | string | Yes | Generation job ID |

**Example:**
```json
{
  "command": "get_sprite_generation_status",
  "params": {
    "jobId": "my_jobId"
  }
}
```

Scope: `generation:read` | Token cost: 0

---

### `get_generation_status`

Query the status of any AI generation job by ID

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `jobId` | string | Yes | Generation job ID to query |
| `type` | `"model"` \| `"texture"` \| `"skybox"` \| `"music"` \| `"sprite"` \| `"voice"` \| `"sprite_sheet"` \| `"tileset"` \| `"pixel-art"` | No | Job type (auto-detected if omitted) |

**Example:**
```json
{
  "command": "get_generation_status",
  "params": {
    "jobId": "my_jobId"
  }
}
```

Scope: `scene:read` | Token cost: 0

---

### `generate_pixel_art`

Generate pixel art from a text prompt with palette and dithering options

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `prompt` | string | Yes | Description of the pixel art to generate |
| `targetSize` | `"16"` \| `"32"` \| `"64"` \| `"128"` | No | Target sprite size in pixels (default: 32) |
| `palette` | string | No | Palette preset ID (e.g., pico-8, db16, db32, nes, game-boy, cga, custom) |
| `style` | `"character"` \| `"prop"` \| `"tile"` \| `"icon"` \| `"environment"` | No | Pixel art style preset |
| `dithering` | `"none"` \| `"bayer4x4"` \| `"bayer8x8"` | No | Dithering algorithm (default: none) |
| `ditheringIntensity` | number | No | Dithering intensity 0-1 (default: 0) |
| `entityId` | string | No | Entity ID to attach the pixel art sprite to |
| `targetEntityId` | string | No | Entity ID to attach the pixel art sprite to (takes precedence over entityId) |
| `autoPlace` | boolean | No | Automatically attach the generated pixel art to the target entity when complete (default true when entityId/targetEntityId is set) |

**Example:**
```json
{
  "command": "generate_pixel_art",
  "params": {
    "prompt": "my_prompt"
  }
}
```

Scope: `generation:write` | Token cost: 10

---

### `set_pixel_art_palette`

Set the active palette for pixel art generation

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `palette` | string | Yes | Palette preset ID or 'custom' |
| `colors` | string[] | No | Hex color array (required when palette is 'custom') |

**Example:**
```json
{
  "command": "set_pixel_art_palette",
  "params": {
    "palette": "my_palette"
  }
}
```

Scope: `generation:write` | Token cost: 0

---

### `quantize_sprite_colors`

Reduce sprite colors to a target count with optional dithering

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `colorCount` | number | Yes | Target number of colors (1-256) |
| `dithering` | `"none"` \| `"bayer4x4"` \| `"bayer8x8"` | No | Dithering algorithm (default: none) |
| `ditheringIntensity` | number | No | Dithering intensity 0-1 (default: 0.5) |

**Example:**
```json
{
  "command": "quantize_sprite_colors",
  "params": {
    "colorCount": 1
  }
}
```

Scope: `generation:write` | Token cost: 0

---

### `generate_game_ideas`

Generate 1-5 structured game concepts by remixing genres and mechanics. Returns each idea with title, description, primary/secondary genre, mechanics list, a novelty score (0-100), audience hooks, and a recommended starter template. Use this when the user wants inspiration or is starting a new project.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `count` | number | No | Number of ideas to generate (1-5, default 3) |
| `genreIds` | string[] | No | Restrict generation to specific genre IDs (e.g. platformer, roguelike, puzzle, survival, rpg, racing, rhythm, sandbox, horror, shooter, simulation, idle, metroidvania, card-game) |
| `mechanicIds` | string[] | No | Require specific mechanic IDs in the output (e.g. time-rewind, crafting, deck-building, stealth, physics-sim) |
| `maxComplexity` | `"low"` \| `"medium"` \| `"high"` | No | Maximum mechanic complexity to include (default: high — includes all) |
| `trendingOnly` | boolean | No | Only use trending genres (default false) |

**Example:**
```json
{
  "command": "generate_game_ideas",
  "params": {}
}
```

Scope: `scene:read` | Token cost: 0

---

### `get_idea_details`

Expand a brief game idea into a full Game Design Document (GDD) outline. Returns a structured GDD prompt covering gameplay loop, mechanics, art direction, sound, progression, and monetization. Call after generate_game_ideas when the user wants to explore a specific idea further.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `primaryGenre` | string | No | Primary genre ID or name (e.g. platformer, roguelike) |
| `secondaryGenre` | string | No | Secondary genre ID or name to blend with |
| `mechanics` | string[] | No | Mechanic IDs or names to include in the design |
| `title` | string | No | Optional title override for the game concept |
| `ideaId` | string | No | ID of a previously generated idea to expand |

**Example:**
```json
{
  "command": "get_idea_details",
  "params": {}
}
```

Scope: `scene:read` | Token cost: 0

---

### `start_from_idea`

Scaffold a new game project from a structured idea. Selects the matching starter template, determines 2D/3D project type from genre tags, creates the initial scene using create_scene, and returns the project configuration. Use this when the user clicks 'Start' on a generated idea.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `title` | string | Yes | Game title (used as project and scene name) |
| `primaryGenre` | string | Yes | Primary genre ID or name |
| `secondaryGenre` | string | Yes | Secondary genre ID or name |
| `mechanics` | string[] | No | List of mechanic names to include in the project |
| `templateMatch` | `"platformer"` \| `"runner"` \| `"shooter"` \| `"puzzle"` \| `"explorer"` | No | Override starter template (auto-selected from genre if omitted) |

**Example:**
```json
{
  "command": "start_from_idea",
  "params": {
    "title": "my_title",
    "primaryGenre": "my_primaryGenre",
    "secondaryGenre": "my_secondaryGenre"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `remix_idea`

Mutate one dimension of an existing game idea to produce a fresh variation. 'genre' swaps the secondary genre, 'mechanic' replaces one mechanic with a random alternative, 'both' changes both. Returns a new GameIdea with score and hooks.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `primaryGenre` | string | Yes | Primary genre ID of the idea to remix |
| `secondaryGenre` | string | Yes | Secondary genre ID of the idea to remix |
| `mechanics` | string[] | No | Mechanic IDs of the idea to remix |
| `dimension` | `"genre"` \| `"mechanic"` \| `"both"` | No | Which dimension to change (default: mechanic) |

**Example:**
```json
{
  "command": "remix_idea",
  "params": {
    "primaryGenre": "my_primaryGenre",
    "secondaryGenre": "my_secondaryGenre"
  }
}
```

Scope: `scene:read` | Token cost: 0

---

## Ui

### `create_ui_screen`

Create a new UI screen for in-game interfaces

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | Yes | Screen name (e.g., 'HUD', 'Pause Menu') |
| `preset` | `"blank"` \| `"hud"` \| `"main_menu"` \| `"pause_menu"` \| `"game_over"` \| `"inventory"` \| `"dialog"` | No | Optional screen preset with pre-built widgets |
| `showOnStart` | boolean | No | Auto-show when Play mode starts |
| `showOnKey` | string | No | Key to toggle visibility (e.g., 'Escape', 'Tab') |
| `backgroundColor` | string | No | Screen backdrop color (CSS color string) |
| `blockInput` | boolean | No | Block 3D input when screen is visible |

**Example:**
```json
{
  "command": "create_ui_screen",
  "params": {
    "name": "my_name"
  }
}
```

Scope: `ui:write` | Token cost: 0

---

### `delete_ui_screen`

Delete a UI screen by name or ID

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `screenId` | string | Yes | Screen ID or name |

**Example:**
```json
{
  "command": "delete_ui_screen",
  "params": {
    "screenId": "my_screenId"
  }
}
```

Scope: `ui:write` | Token cost: 0

---

### `list_ui_screens`

List all UI screens in the project

**Example:**
```json
{
  "command": "list_ui_screens",
  "params": {}
}
```

Scope: `ui:read` | Token cost: 0

---

### `get_ui_screen`

Get details of a specific UI screen including its widgets

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `screenId` | string | Yes | Screen ID or name |

**Example:**
```json
{
  "command": "get_ui_screen",
  "params": {
    "screenId": "my_screenId"
  }
}
```

Scope: `ui:read` | Token cost: 0

---

### `update_ui_screen`

Update screen properties (name, transition, visibility settings)

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `screenId` | string | Yes | Screen ID or name |
| `name` | string | No |  |
| `showOnStart` | boolean | No |  |
| `showOnKey` | string | No |  |
| `backgroundColor` | string | No |  |
| `blockInput` | boolean | No |  |
| `transition` | object | No |  |
| `zIndex` | number | No |  |

**Example:**
```json
{
  "command": "update_ui_screen",
  "params": {
    "screenId": "my_screenId"
  }
}
```

Scope: `ui:write` | Token cost: 0

---

### `add_ui_widget`

Add a widget to a UI screen

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `screenId` | string | Yes | Screen ID or name |
| `type` | `"text"` \| `"image"` \| `"button"` \| `"progress_bar"` \| `"panel"` \| `"grid"` \| `"scroll_view"` \| `"slider"` \| `"toggle"` \| `"minimap"` | Yes | Widget type |
| `name` | string | No | Widget display name |
| `x` | number | No | X position (0-100%) |
| `y` | number | No | Y position (0-100%) |
| `width` | number | No | Width (0-100%) |
| `height` | number | No | Height (0-100%) |
| `anchor` | `"top_left"` \| `"top_center"` \| `"top_right"` \| `"center_left"` \| `"center"` \| `"center_right"` \| `"bottom_left"` \| `"bottom_center"` \| `"bottom_right"` | No |  |
| `parentWidgetId` | string | No | Parent widget ID for nesting |
| `config` | object | No | Type-specific configuration |
| `style` | object | No | Style overrides |

**Example:**
```json
{
  "command": "add_ui_widget",
  "params": {
    "screenId": "my_screenId",
    "type": "text"
  }
}
```

Scope: `ui:write` | Token cost: 0

---

### `update_ui_widget`

Update a widget's properties, config, or style

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `screenId` | string | Yes | Screen ID or name |
| `widgetId` | string | Yes | Widget ID or name |
| `name` | string | No |  |
| `x` | number | No |  |
| `y` | number | No |  |
| `width` | number | No |  |
| `height` | number | No |  |
| `anchor` | string | No |  |
| `visible` | boolean | No |  |
| `config` | object | No | Type-specific config updates (merged) |
| `style` | object | No | Style updates (merged) |

**Example:**
```json
{
  "command": "update_ui_widget",
  "params": {
    "screenId": "my_screenId",
    "widgetId": "my_widgetId"
  }
}
```

Scope: `ui:write` | Token cost: 0

---

### `remove_ui_widget`

Remove a widget from a UI screen

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `screenId` | string | Yes | Screen ID or name |
| `widgetId` | string | Yes | Widget ID or name |

**Example:**
```json
{
  "command": "remove_ui_widget",
  "params": {
    "screenId": "my_screenId",
    "widgetId": "my_widgetId"
  }
}
```

Scope: `ui:write` | Token cost: 0

---

### `set_ui_binding`

Bind a widget property to a forge.state variable

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `screenId` | string | Yes |  |
| `widgetId` | string | Yes |  |
| `property` | string | Yes | Widget property to bind (e.g., 'content', 'value') |
| `stateKey` | string | Yes | forge.state key to bind to |
| `direction` | `"read"` \| `"write"` \| `"read_write"` | No |  |
| `transform` | object | No | Optional transform (format, map, clamp, multiply, round) |

**Example:**
```json
{
  "command": "set_ui_binding",
  "params": {
    "screenId": "my_screenId",
    "widgetId": "my_widgetId",
    "property": "my_property",
    "stateKey": "my_stateKey"
  }
}
```

Scope: `ui:write` | Token cost: 0

---

### `remove_ui_binding`

Remove a data binding from a widget property

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `screenId` | string | Yes |  |
| `widgetId` | string | Yes |  |
| `property` | string | Yes |  |

**Example:**
```json
{
  "command": "remove_ui_binding",
  "params": {
    "screenId": "my_screenId",
    "widgetId": "my_widgetId",
    "property": "my_property"
  }
}
```

Scope: `ui:write` | Token cost: 0

---

### `set_ui_theme`

Set the global UI theme

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `primaryColor` | string | No |  |
| `secondaryColor` | string | No |  |
| `backgroundColor` | string | No |  |
| `textColor` | string | No |  |
| `fontFamily` | string | No |  |
| `fontSize` | number | No |  |
| `borderRadius` | number | No |  |

**Example:**
```json
{
  "command": "set_ui_theme",
  "params": {}
}
```

Scope: `ui:write` | Token cost: 0

---

### `duplicate_ui_screen`

Duplicate a UI screen and all its widgets

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `screenId` | string | Yes | Screen ID or name to duplicate |
| `newName` | string | No | Name for the duplicate |

**Example:**
```json
{
  "command": "duplicate_ui_screen",
  "params": {
    "screenId": "my_screenId"
  }
}
```

Scope: `ui:write` | Token cost: 0

---

### `duplicate_ui_widget`

Duplicate a widget within a screen

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `screenId` | string | Yes |  |
| `widgetId` | string | Yes |  |

**Example:**
```json
{
  "command": "duplicate_ui_widget",
  "params": {
    "screenId": "my_screenId",
    "widgetId": "my_widgetId"
  }
}
```

Scope: `ui:write` | Token cost: 0

---

### `reorder_ui_widget`

Move a widget forward or backward in the render order

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `screenId` | string | Yes |  |
| `widgetId` | string | Yes |  |
| `direction` | `"up"` \| `"down"` \| `"to_front"` \| `"to_back"` | Yes |  |

**Example:**
```json
{
  "command": "reorder_ui_widget",
  "params": {
    "screenId": "my_screenId",
    "widgetId": "my_widgetId",
    "direction": "up"
  }
}
```

Scope: `ui:write` | Token cost: 0

---

### `get_ui_widget`

Get details of a specific widget

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `screenId` | string | Yes |  |
| `widgetId` | string | Yes |  |

**Example:**
```json
{
  "command": "get_ui_widget",
  "params": {
    "screenId": "my_screenId",
    "widgetId": "my_widgetId"
  }
}
```

Scope: `ui:read` | Token cost: 0

---

## Compound

### `create_scene_from_description`

Create a complete scene with multiple entities, materials, lights, and positioning from a structured description. Use this instead of calling spawn_entity + update_transform + update_material repeatedly. Claude should convert the user's natural language description into the structured format before calling this tool.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `clearExisting` | boolean | No | If true, clear the scene before creating new entities (default: false) |
| `entities` | object[] | Yes | Entities to create |
| `environment` | object | No | Optional environment settings to apply |

**Example:**
```json
{
  "command": "create_scene_from_description",
  "params": {
    "entities": []
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `create_level_layout`

Generate a game level layout with ground, walls, obstacles, spawn points, and goals. Claude should convert the user's level description into this structured format. Each zone is placed relative to the level origin.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `levelName` | string | Yes | Name for the level root entity |
| `ground` | object | No | Ground plane configuration |
| `walls` | object[] | No | Boundary walls and barriers |
| `obstacles` | object[] | No | Static or dynamic obstacles |
| `spawnPoints` | object[] | No | Player and entity spawn locations |
| `goals` | object[] | No | Goal/objective markers |
| `inputPreset` | `"fps"` \| `"platformer"` \| `"topdown"` \| `"racing"` | No | Input binding preset to apply |

**Example:**
```json
{
  "command": "create_level_layout",
  "params": {
    "levelName": "my_levelName"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `configure_game_mechanics`

Configure game mechanics as a bundle: input bindings, physics settings, game components on entities, and environment. Use this to set up a game genre (platformer, FPS, top-down, racing) in one call instead of configuring each system separately.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `inputPreset` | `"fps"` \| `"platformer"` \| `"topdown"` \| `"racing"` | No | Input binding preset |
| `customBindings` | object[] | No | Additional custom input bindings beyond the preset |
| `physicsDefaults` | object | No | Default physics settings to apply to entities missing physics |
| `entityConfigs` | object[] | No | Per-entity game component and physics setup. Reference entities by name. |
| `qualityPreset` | `"low"` \| `"medium"` \| `"high"` \| `"ultra"` | No | Rendering quality preset |

**Example:**
```json
{
  "command": "configure_game_mechanics",
  "params": {}
}
```

Scope: `scene:write` | Token cost: 0

---

### `setup_character`

Spawn and configure a playable character entity with movement controller, physics, camera behavior, health, and optional script. This creates a game-ready player character in one call.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | No | Character name (default: 'Player') |
| `position` | number[3] | No |  |
| `entityType` | `"capsule"` \| `"cube"` \| `"sphere"` \| `"cylinder"` | No | Mesh shape for the character (default: capsule) |
| `material` | object | No | Material for the character mesh |
| `controller` | object | No | Character controller settings |
| `health` | object | No | Health component settings (null to disable) |
| `inputPreset` | `"fps"` \| `"platformer"` \| `"topdown"` \| `"racing"` | No | Input binding preset (default: platformer) |
| `cameraFollow` | boolean | No | Attach a camera-follow script (default: true) |
| `cameraOffset` | number[3] | No | Camera offset from character [x, y, z] (default: [0, 5, -10]) |

**Example:**
```json
{
  "command": "setup_character",
  "params": {}
}
```

Scope: `scene:write` | Token cost: 0

---

### `setup_game_from_description`

Scaffold a complete, immediately-playable game from a plain-text description in one call. Deterministically sets the project type, environment, and input preset, then spawns a player (with character controller + health), enemies, collectible coins, a goal carrying a win condition, and a ground plane, and attaches a camera-follow script. Optionally dispatches parallel asset-generation jobs that auto-wire back onto the scaffolded entities.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `description` | string | Yes | Plain-text description of the game to scaffold (e.g. 'a platformer with 3 enemies and 5 coins'). |
| `genre` | string | No | Optional genre hint (e.g. 'fps', 'platformer', 'topdown', 'racing') that nudges the input preset. |
| `targetTier` | `"low"` \| `"mid"` \| `"high"` | No | Optional asset-fidelity tier. When set, parallel generate_* jobs are dispatched to replace the placeholder primitives; the scaffold is fully playable before they land. |

**Example:**
```json
{
  "command": "setup_game_from_description",
  "params": {
    "description": "my_description"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `arrange_entities`

Arrange existing entities in spatial patterns. Provide entity IDs and a pattern type. This repositions entities without changing their other properties.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityIds` | string[] | Yes | Entity IDs to arrange |
| `pattern` | `"grid"` \| `"circle"` \| `"line"` \| `"scatter"` \| `"path"` | Yes | Arrangement pattern |
| `center` | number[3] | No | Center point of the arrangement (default: [0, 0, 0]) |
| `gridColumns` | integer | No | Columns for grid pattern |
| `spacing` | number | No | Spacing between items (default: 2.0) |
| `radius` | number | No | Radius for circle pattern (default: 5.0) |
| `direction` | number[3] | No | Direction vector for line pattern (default: [1, 0, 0]) |
| `scatterRadius` | number | No | Radius for scatter pattern (default: 10.0) |
| `scatterSeed` | integer | No | Random seed for scatter (for determinism) |
| `pathPoints` | array[] | No | Waypoints for path pattern -- entities are distributed evenly along the path |
| `faceCenter` | boolean | No | Rotate entities to face the center point (default: false, only for circle) |
| `yOffset` | number | No | Y-axis offset applied to all positions (default: 0) |

**Example:**
```json
{
  "command": "arrange_entities",
  "params": {
    "entityIds": [
      "entity_1"
    ],
    "pattern": "grid"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `apply_style`

Apply a visual style to the scene. Adjusts materials, lighting, environment, and post-processing to achieve a cohesive look. Claude should convert mood descriptions ('spooky', 'cheerful', 'sci-fi') into this structured style format.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `targetEntityIds` | string[] | No | Apply material changes only to these entities. If omitted, applies to all mesh entities. |
| `palette` | object | No | Color palette to apply |
| `materialOverrides` | object | No | Global material adjustments applied to all targeted entities |
| `lighting` | object | No | Lighting mood settings |
| `postProcessing` | object | No | Post-processing adjustments |

**Example:**
```json
{
  "command": "apply_style",
  "params": {}
}
```

Scope: `scene:write` | Token cost: 0

---

### `describe_scene`

Generate a detailed natural language description of the current scene including all entities, their properties, relationships, materials, lighting, physics, scripts, game components, and environment settings. Returns structured data that the AI can use to understand and reason about the scene.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `detail` | `"summary"` \| `"standard"` \| `"full"` | No | Level of detail: summary (entity count + types), standard (names + positions + key properties), full (every property on every entity) |
| `filterEntityIds` | string[] | No | Only describe these specific entities (if omitted, describe all) |

**Example:**
```json
{
  "command": "describe_scene",
  "params": {}
}
```

Scope: `scene:read` | Token cost: 0

---

### `analyze_gameplay`

Analyze the current scene's game design. Returns a structured analysis of game mechanics, entity roles, potential issues, and suggestions. Use this to understand what the game does before making changes.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `focus` | `"overview"` \| `"physics"` \| `"scripts"` \| `"components"` \| `"balance"` | No | Analysis focus area (default: overview) |

**Example:**
```json
{
  "command": "analyze_gameplay",
  "params": {}
}
```

Scope: `scene:read` | Token cost: 0

---

## Templates

### `list_templates`

List all available game templates with metadata. Templates are pre-built games ready to play or customize.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `category` | `"platformer"` \| `"runner"` \| `"shooter"` \| `"puzzle"` \| `"explorer"` | No | Filter by category (optional) |

**Example:**
```json
{
  "command": "list_templates",
  "params": {}
}
```

Scope: `scene:read` | Token cost: 0

---

### `load_template`

Load a game template as the current project. Replaces the current scene with a pre-built game.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `templateId` | `"platformer"` \| `"runner"` \| `"shooter"` \| `"puzzle"` \| `"explorer"` \| `"2d-platformer"` \| `"2d-topdown"` \| `"2d-shmup"` \| `"2d-puzzle"` \| `"2d-fighter"` \| `"2d-metroidvania"` | Yes | Template ID to load |

**Example:**
```json
{
  "command": "load_template",
  "params": {
    "templateId": "platformer"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `get_template_info`

Get detailed information about a specific game template, including entity count and features.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `templateId` | string | Yes | Template ID |

**Example:**
```json
{
  "command": "get_template_info",
  "params": {
    "templateId": "my_templateId"
  }
}
```

Scope: `scene:read` | Token cost: 0

---

## Dialogue

### `create_dialogue_tree`

Create a new dialogue tree with an initial text node

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | Yes | Tree name |
| `startNodeText` | string | No | Initial text node content (optional) |

**Example:**
```json
{
  "command": "create_dialogue_tree",
  "params": {
    "name": "my_name"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `add_dialogue_node`

Add a node to a dialogue tree. Types: text, choice, condition, action, end

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `treeId` | string | Yes | Dialogue tree ID |
| `nodeType` | `"text"` \| `"choice"` \| `"condition"` \| `"action"` \| `"end"` | Yes | Node type |
| `speaker` | string | No | Speaker name (for text nodes) |
| `text` | string | No | Dialogue text |
| `connectFromNodeId` | string | No | Connect from this node (sets its next field) |

**Example:**
```json
{
  "command": "add_dialogue_node",
  "params": {
    "treeId": "my_treeId",
    "nodeType": "text"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `set_dialogue_choice`

Add or update a choice in a choice node

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `treeId` | string | Yes | Dialogue tree ID |
| `nodeId` | string | Yes | Choice node ID |
| `choiceText` | string | Yes | Choice display text |
| `nextNodeId` | string | No | Node to go to when chosen |

**Example:**
```json
{
  "command": "set_dialogue_choice",
  "params": {
    "treeId": "my_treeId",
    "nodeId": "my_nodeId",
    "choiceText": "my_choiceText"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `remove_dialogue_tree`

Delete a dialogue tree

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `treeId` | string | Yes | Tree ID to delete |

**Example:**
```json
{
  "command": "remove_dialogue_tree",
  "params": {
    "treeId": "my_treeId"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `get_dialogue_tree`

Get full dialogue tree data including all nodes

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `treeId` | string | Yes | Dialogue tree ID |

**Example:**
```json
{
  "command": "get_dialogue_tree",
  "params": {
    "treeId": "my_treeId"
  }
}
```

Scope: `scene:read` | Token cost: 0

---

### `set_dialogue_node_voice`

Assign a voice audio asset to a dialogue text node

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `treeId` | string | Yes | Dialogue tree ID |
| `nodeId` | string | Yes | Text node ID |
| `voiceAssetId` | string | Yes | Audio asset ID for voice |

**Example:**
```json
{
  "command": "set_dialogue_node_voice",
  "params": {
    "treeId": "my_treeId",
    "nodeId": "my_nodeId",
    "voiceAssetId": "my_voiceAssetId"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `export_dialogue_tree`

Export a dialogue tree as JSON string

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `treeId` | string | Yes | Tree ID to export |

**Example:**
```json
{
  "command": "export_dialogue_tree",
  "params": {
    "treeId": "my_treeId"
  }
}
```

Scope: `scene:read` | Token cost: 0

---

### `import_dialogue_tree`

Import a dialogue tree from JSON string

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `jsonData` | string | Yes | JSON string of dialogue tree data |

**Example:**
```json
{
  "command": "import_dialogue_tree",
  "params": {
    "jsonData": "my_jsonData"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

## Publishing

### `publish_game`

Publish the current project to a shareable URL

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `title` | string | Yes | Game title |
| `slug` | string | Yes | URL slug (lowercase, hyphens) |
| `description` | string | No | Brief game description |

**Example:**
```json
{
  "command": "publish_game",
  "params": {
    "title": "my_title",
    "slug": "my_slug"
  }
}
```

Scope: `project:manage` | Token cost: 0

---

### `unpublish_game`

Remove a published game from public access

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string | Yes | Published game ID to unpublish |

**Example:**
```json
{
  "command": "unpublish_game",
  "params": {
    "id": "my_id"
  }
}
```

Scope: `project:manage` | Token cost: 0

---

### `list_publications`

List all published games for the current user

**Example:**
```json
{
  "command": "list_publications",
  "params": {}
}
```

Scope: `project:manage` | Token cost: 0

---

### `get_publish_url`

Get the public URL for a published game

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `slug` | string | Yes | Game slug to look up |

**Example:**
```json
{
  "command": "get_publish_url",
  "params": {
    "slug": "my_slug"
  }
}
```

Scope: `project:manage` | Token cost: 0

---

### `create_leaderboard`

Define a leaderboard for the current published game. Leaderboards are identified by name and can be sorted highest-first (desc) or lowest-first (asc). Call this once per leaderboard during game setup.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `gameId` | string | Yes | Published game ID to attach the leaderboard to |
| `name` | string | Yes | Unique leaderboard name within this game (e.g. 'highscore', 'speedrun') |
| `sortOrder` | `"desc"` \| `"asc"` | No | Sort order: 'desc' = highest score wins (default), 'asc' = lowest score wins (e.g. speedrun times) |
| `maxEntries` | number | No | Maximum number of entries to retain (default: 100, max: 1000) |
| `minScore` | number | No | Optional minimum score bound — submissions below this are rejected with 400 |
| `maxScore` | number | No | Optional maximum score bound — submissions above this are rejected with 400 (useful for anti-cheat) |

**Example:**
```json
{
  "command": "create_leaderboard",
  "params": {
    "gameId": "my_gameId",
    "name": "my_name"
  }
}
```

Scope: `project:manage` | Token cost: 0

---

### `list_leaderboards`

List all leaderboards configured for a published game, including their sort order and entry counts.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `gameId` | string | Yes | Published game ID |

**Example:**
```json
{
  "command": "list_leaderboards",
  "params": {
    "gameId": "my_gameId"
  }
}
```

Scope: `project:manage` | Token cost: 0

---

### `configure_leaderboard`

Update an existing leaderboard's configuration: sort order, max entries, or score bounds. Does not affect existing entries.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `gameId` | string | Yes | Published game ID |
| `name` | string | Yes | Name of the leaderboard to update |
| `sortOrder` | `"desc"` \| `"asc"` | No | New sort order |
| `maxEntries` | number | No | New maximum number of retained entries |
| `minScore` | number | No | New minimum score bound (null to remove) |
| `maxScore` | number | No | New maximum score bound (null to remove) |

**Example:**
```json
{
  "command": "configure_leaderboard",
  "params": {
    "gameId": "my_gameId",
    "name": "my_name"
  }
}
```

Scope: `project:manage` | Token cost: 0

---

### `delete_leaderboard`

Delete a leaderboard and all its entries permanently. This cannot be undone.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `gameId` | string | Yes | Published game ID |
| `name` | string | Yes | Name of the leaderboard to delete |

**Example:**
```json
{
  "command": "delete_leaderboard",
  "params": {
    "gameId": "my_gameId",
    "name": "my_name"
  }
}
```

Scope: `project:manage` | Token cost: 0

---

## Sprite

### `create_sprite`

Create a new 2D sprite entity with optional texture, sorting layer, and position

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityType` | `"plane"` \| `"cube"` \| `"sphere"` \| `"cylinder"` \| `"capsule"` | No | Carrier mesh spawned to hold the sprite (default plane) |
| `name` | string | No | Entity name |
| `position` | number[3] | No | [x, y, z] position |
| `textureAssetId` | string | No | Asset ID for sprite texture |
| `sortingLayer` | `"Background"` \| `"Default"` \| `"Foreground"` \| `"UI"` | No | Sorting layer for draw order |
| `sortingOrder` | integer | No | Order within sorting layer (higher = drawn on top) |

**Example:**
```json
{
  "command": "create_sprite",
  "params": {}
}
```

Scope: `scene:write` | Token cost: 0

---

### `set_sprite_texture`

Assign or change a sprite's texture

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Target entity ID |
| `textureAssetId` | string | Yes | Asset ID for texture |

**Example:**
```json
{
  "command": "set_sprite_texture",
  "params": {
    "entityId": "entity_1",
    "textureAssetId": "my_textureAssetId"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `set_sprite_tint`

Set the color tint (RGBA multiplier) for a sprite

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Target entity ID |
| `color` | string | Yes | Hex color string, e.g. #RGB, #RGBA, #RRGGBB, or #RRGGBBAA |

**Example:**
```json
{
  "command": "set_sprite_tint",
  "params": {
    "entityId": "entity_1",
    "color": "my_color"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `set_sprite_flip`

Flip a sprite horizontally or vertically

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Target entity ID |
| `flipX` | boolean | No | Flip horizontally |
| `flipY` | boolean | No | Flip vertically |

**Example:**
```json
{
  "command": "set_sprite_flip",
  "params": {
    "entityId": "entity_1"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `set_sprite_sorting`

Set sorting layer and order for draw order control

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Target entity ID |
| `sortingLayer` | string | No | Layer name |
| `sortingOrder` | number | No | Order within layer |

**Example:**
```json
{
  "command": "set_sprite_sorting",
  "params": {
    "entityId": "entity_1"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `set_sprite_anchor`

Set the anchor/origin point of a sprite

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Target entity ID |
| `anchor` | `"center"` \| `"top_left"` \| `"top_center"` \| `"top_right"` \| `"middle_left"` \| `"middle_right"` \| `"bottom_left"` \| `"bottom_center"` \| `"bottom_right"` | Yes | Anchor point |

**Example:**
```json
{
  "command": "set_sprite_anchor",
  "params": {
    "entityId": "entity_1",
    "anchor": "center"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `get_sprite`

Query all sprite properties for an entity

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Target entity ID |

**Example:**
```json
{
  "command": "get_sprite",
  "params": {
    "entityId": "entity_1"
  }
}
```

Scope: `scene:read` | Token cost: 0

---

### `set_sorting_layers`

Configure 2D sprite sorting layers and their render order

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `layers` | object[] | Yes | Array of sorting layer definitions |

**Example:**
```json
{
  "command": "set_sorting_layers",
  "params": {
    "layers": []
  }
}
```

Scope: `scene:write` | Token cost: 0

---

## Sprite_animation

### `slice_sprite_sheet`

Define how to slice a sprite sheet into animation frames

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Target entity ID |
| `assetId` | string | Yes | Asset ID of the sprite sheet image |
| `sliceMode` | object | No | Slicing mode (grid or manual); omit to slice as a single manual region |
| `clips` | object[] | No | Animation clips to create from the sliced frames |

**Example:**
```json
{
  "command": "slice_sprite_sheet",
  "params": {
    "entityId": "entity_1",
    "assetId": "my_assetId"
  }
}
```

Scope: `scene:write` | Token cost: 1

---

### `create_sprite_anim_clip`

Create a named animation clip from sprite sheet frames

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Entity with an existing sprite sheet |
| `clipName` | string | Yes | Name of the animation clip |
| `frames` | integer[] | Yes | Frame indices to include |
| `fps` | number | No | Frames per second (default 12) |
| `looping` | boolean | No | Whether to loop the animation (default true) |

**Example:**
```json
{
  "command": "create_sprite_anim_clip",
  "params": {
    "entityId": "entity_1",
    "clipName": "my_clipName",
    "frames": []
  }
}
```

Scope: `scene:write` | Token cost: 1

---

### `set_sprite_animator`

Configure sprite animator on an entity

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Target entity ID |
| `spriteSheetId` | string | Yes | Sprite sheet asset ID |
| `currentClip` | string | No | Initial clip to play |
| `playing` | boolean | No | Whether the animator starts playing immediately (default false) |
| `speed` | number | No | Playback speed multiplier (default 1.0) |

**Example:**
```json
{
  "command": "set_sprite_animator",
  "params": {
    "entityId": "entity_1",
    "spriteSheetId": "my_spriteSheetId"
  }
}
```

Scope: `scene:write` | Token cost: 1

---

### `play_sprite_animation`

Start playing an animation clip on a sprite

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Entity with an existing sprite animator |
| `clipName` | string | Yes | Name of clip to play |

**Example:**
```json
{
  "command": "play_sprite_animation",
  "params": {
    "entityId": "entity_1",
    "clipName": "my_clipName"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `set_anim_state_machine`

Configure animation state machine for a sprite

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Target entity ID |
| `states` | object | Yes | Map of state name to clip name |
| `transitions` | object[] | Yes | State transitions |
| `currentState` | string | Yes | Starting state name |
| `parameters` | object | Yes | Map of parameter name to a discriminated {type, value} pair (bool | float | trigger) |

**Example:**
```json
{
  "command": "set_anim_state_machine",
  "params": {
    "entityId": "entity_1",
    "transitions": [],
    "currentState": "my_currentState"
  }
}
```

Scope: `scene:write` | Token cost: 2

---

### `set_anim_param`

Set animation state machine parameter

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Entity with an existing animation state machine |
| `paramName` | string | Yes | Parameter name |
| `value` | undefined | Yes | Parameter value (boolean or number) |

**Example:**
```json
{
  "command": "set_anim_param",
  "params": {
    "entityId": "entity_1",
    "paramName": "my_paramName"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

## Physics2d

### `set_physics2d`

Configure 2D physics on an entity

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Target entity ID |
| `bodyType` | `"dynamic"` \| `"static"` \| `"kinematic"` | No | Physics body type |
| `colliderShape` | `"box"` \| `"circle"` \| `"capsule"` \| `"convex_polygon"` \| `"edge"` \| `"auto"` | No | Collider shape |
| `size` | number[2] | No | Width and height [w, h] |
| `radius` | number | No | Radius for circle/capsule |
| `mass` | number | No | Mass (dynamic bodies only) |
| `friction` | number | No | Surface friction (0-2) |
| `restitution` | number | No | Bounciness (0-1) |
| `gravityScale` | number | No | Gravity multiplier |
| `isSensor` | boolean | No | Trigger volume (no collision response) |
| `lockRotation` | boolean | No | Prevent rotation |
| `continuousDetection` | boolean | No | CCD for fast objects |
| `oneWayPlatform` | boolean | No | Only collide from above (static only) |
| `vertices` | array[] | No | Polygon vertices [[x, y], ...] for the convex_polygon collider shape |
| `surfaceVelocity` | number[2] | No | Constant surface velocity [x, y] for conveyor-belt-style one-way platforms |

**Example:**
```json
{
  "command": "set_physics2d",
  "params": {
    "entityId": "entity_1"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `remove_physics2d`

Remove 2D physics from an entity

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Target entity ID |

**Example:**
```json
{
  "command": "remove_physics2d",
  "params": {
    "entityId": "entity_1"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `get_physics2d`

Query 2D physics data for an entity. Applied in both the editor and exported (runtime) games (#9550).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Target entity ID |

**Example:**
```json
{
  "command": "get_physics2d",
  "params": {
    "entityId": "entity_1"
  }
}
```

Scope: `scene:read` | Token cost: 0

---

### `set_gravity2d`

Set global 2D gravity. Applied in both the editor and exported (runtime) games (#9550).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `x` | number | No | Horizontal gravity (default 0) |
| `y` | number | No | Vertical gravity, negative = downward (default -9.81) |

**Example:**
```json
{
  "command": "set_gravity2d",
  "params": {}
}
```

Scope: `scene:write` | Token cost: 0

---

### `set_debug_physics2d`

Toggle 2D physics debug rendering. Applied in both the editor and exported (runtime) games (#9550).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `enabled` | boolean | Yes | Show collider wireframes |

**Example:**
```json
{
  "command": "set_debug_physics2d",
  "params": {
    "enabled": true
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `apply_force2d`

Apply force to a 2D physics body

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Target entity ID |
| `force` | number[2] | Yes | [x, y] force vector |
| `point` | number[2] | No | [x, y] world-space application point (defaults to center of mass) |

**Example:**
```json
{
  "command": "apply_force2d",
  "params": {
    "entityId": "entity_1",
    "force": []
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `apply_impulse2d`

Apply instant impulse to a 2D physics body

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Target entity ID |
| `impulse` | number[2] | Yes | [x, y] impulse vector |
| `point` | number[2] | No | [x, y] world-space application point (defaults to center of mass) |

**Example:**
```json
{
  "command": "apply_impulse2d",
  "params": {
    "entityId": "entity_1",
    "impulse": []
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `raycast2d`

Cast a ray in the 2D physics world

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `originX` | number | Yes | Ray start X |
| `originY` | number | Yes | Ray start Y |
| `directionX` | number | Yes | Ray direction X |
| `directionY` | number | Yes | Ray direction Y |
| `maxDistance` | number | No | Max ray distance |

**Example:**
```json
{
  "command": "raycast2d",
  "params": {
    "originX": 1,
    "originY": 1,
    "directionX": 1,
    "directionY": 1
  }
}
```

Scope: `scene:read` | Token cost: 0

---

## Tilemap

### `create_tilemap`

Create a new tilemap entity backed by an imported tileset

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | No | Display name for the tilemap (default: "Tilemap") |
| `tilesetAssetId` | string | Yes | Asset ID of a tileset previously registered with import_tileset |
| `tileSize` | number[2] | No | Size of each tile in pixels [width, height] (default: [32, 32]) |
| `mapSize` | number[2] | No | Tilemap dimensions in tiles [width, height] (default: [20, 15]) |
| `origin` | `"TopLeft"` \| `"Center"` | No | Grid origin (default: TopLeft) |

**Example:**
```json
{
  "command": "create_tilemap",
  "params": {
    "tilesetAssetId": "my_tilesetAssetId"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `import_tileset`

Register a tileset atlas so tilemaps can reference it by asset ID

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `assetId` | string | Yes | Asset ID of the tileset image |
| `name` | string | No | Display name for the tileset |
| `tileSize` | number[2] | Yes | Size of each tile in pixels [width, height] |
| `gridSize` | number[2] | Yes | Atlas dimensions in tiles [columns, rows] |
| `spacing` | number | No | Spacing between tiles in pixels (default: 0) |
| `margin` | number | No | Margin around the atlas in pixels (default: 0) |

**Example:**
```json
{
  "command": "import_tileset",
  "params": {
    "assetId": "my_assetId",
    "tileSize": [],
    "gridSize": []
  }
}
```

Scope: `asset:write` | Token cost: 0

---

### `set_tile`

Set a single tile on one tilemap layer

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Tilemap entity ID |
| `layerIndex` | integer | Yes | Layer index |
| `x` | integer | Yes | Tile X coordinate |
| `y` | integer | Yes | Tile Y coordinate |
| `tileIndex` | integer,null | Yes | Tile index from the tileset, or null to erase the cell |

**Example:**
```json
{
  "command": "set_tile",
  "params": {
    "entityId": "entity_1",
    "layerIndex": 1,
    "x": 1,
    "y": 1
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `fill_tiles`

Fill an inclusive rectangular range of one tilemap layer with a single tile

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Tilemap entity ID |
| `layerIndex` | integer | Yes | Layer index |
| `fromX` | integer | Yes | First tile column (inclusive) |
| `fromY` | integer | Yes | First tile row (inclusive) |
| `toX` | integer | Yes | Last tile column (inclusive) |
| `toY` | integer | Yes | Last tile row (inclusive) |
| `tileIndex` | integer,null | Yes | Tile index from the tileset, or null to erase the range |

**Example:**
```json
{
  "command": "fill_tiles",
  "params": {
    "entityId": "entity_1",
    "layerIndex": 1,
    "fromX": 1,
    "fromY": 1,
    "toX": 1,
    "toY": 1
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `clear_tiles`

Erase tiles from one tilemap layer; omit the bounds to clear the whole layer

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Tilemap entity ID |
| `layerIndex` | integer | Yes | Layer index |
| `fromX` | integer | No | First tile column (inclusive, default: 0) |
| `fromY` | integer | No | First tile row (inclusive, default: 0) |
| `toX` | integer | No | Last tile column (inclusive, default: last column) |
| `toY` | integer | No | Last tile row (inclusive, default: last row) |

**Example:**
```json
{
  "command": "clear_tiles",
  "params": {
    "entityId": "entity_1",
    "layerIndex": 1
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `add_tilemap_layer`

Append a new layer to the tilemap

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Tilemap entity ID |
| `name` | string | Yes | Layer name |
| `visible` | boolean | No | Layer visibility (default: true) |

**Example:**
```json
{
  "command": "add_tilemap_layer",
  "params": {
    "entityId": "entity_1",
    "name": "my_name"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `remove_tilemap_layer`

Remove a layer from the tilemap; the last remaining layer cannot be removed

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Tilemap entity ID |
| `layerIndex` | integer | Yes | Layer index to remove |

**Example:**
```json
{
  "command": "remove_tilemap_layer",
  "params": {
    "entityId": "entity_1",
    "layerIndex": 1
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `set_tilemap_layer`

Configure layer properties (name, visibility, opacity)

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Tilemap entity ID |
| `layerIndex` | integer | Yes | Layer index |
| `name` | string | No | New layer name |
| `visible` | boolean | No | Layer visibility |
| `opacity` | number | No | Layer opacity (0.0-1.0) |

**Example:**
```json
{
  "command": "set_tilemap_layer",
  "params": {
    "entityId": "entity_1",
    "layerIndex": 1
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `resize_tilemap`

Resize the tilemap grid, anchored at the top-left; trimmed cells are discarded

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Tilemap entity ID |
| `width` | integer | Yes | New width in tiles |
| `height` | integer | Yes | New height in tiles |

**Example:**
```json
{
  "command": "resize_tilemap",
  "params": {
    "entityId": "entity_1",
    "width": 1,
    "height": 1
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `get_tilemap`

Query tilemap data for an entity

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Tilemap entity ID |

**Example:**
```json
{
  "command": "get_tilemap",
  "params": {
    "entityId": "entity_1"
  }
}
```

Scope: `scene:read` | Token cost: 0

---

## Skeleton2d

### `create_skeleton2d`

Create a skeleton on a 2D sprite entity

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Entity ID to add skeleton to |

**Example:**
```json
{
  "command": "create_skeleton2d",
  "params": {
    "entityId": "entity_1"
  }
}
```

Scope: `scene:write` | Token cost: 15

---

### `add_bone2d`

Add a bone to a 2D skeleton

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Skeleton entity ID |
| `name` | string | Yes | Bone name |
| `parentBone` | string | No | Parent bone name (null for root) |
| `position` | number[2] | No | Local position [x, y] |
| `rotation` | number | No | Local rotation in degrees |
| `length` | number | No | Bone length |

**Example:**
```json
{
  "command": "add_bone2d",
  "params": {
    "entityId": "entity_1",
    "name": "my_name"
  }
}
```

Scope: `scene:write` | Token cost: 10

---

### `remove_bone2d`

Remove a bone from a 2D skeleton

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Skeleton entity ID |
| `boneName` | string | Yes | Bone to remove |

**Example:**
```json
{
  "command": "remove_bone2d",
  "params": {
    "entityId": "entity_1",
    "boneName": "my_boneName"
  }
}
```

Scope: `scene:write` | Token cost: 10

---

### `update_bone2d`

Update properties of a bone in a 2D skeleton

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Skeleton entity ID |
| `boneName` | string | Yes | Bone to update |
| `position` | number[2] | No | New local position |
| `rotation` | number | No | New local rotation in degrees |
| `scale` | number[2] | No | New local scale |
| `length` | number | No | New bone length |

**Example:**
```json
{
  "command": "update_bone2d",
  "params": {
    "entityId": "entity_1",
    "boneName": "my_boneName"
  }
}
```

Scope: `scene:write` | Token cost: 10

---

### `create_skeletal_animation2d`

Create a skeletal animation with keyframe tracks

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Skeleton entity ID |
| `name` | string | Yes | Animation name |
| `duration` | number | Yes | Animation duration in seconds |
| `looping` | boolean | No | Whether animation loops |
| `tracks` | object | No | Bone name -> keyframes mapping |

**Example:**
```json
{
  "command": "create_skeletal_animation2d",
  "params": {
    "entityId": "entity_1",
    "name": "my_name",
    "duration": 1
  }
}
```

Scope: `scene:write` | Token cost: 20

---

### `add_keyframe2d`

Add a keyframe to a bone track in a skeletal animation

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Skeleton entity ID |
| `animName` | string | Yes | Animation name |
| `boneName` | string | Yes | Bone name |
| `time` | number | Yes | Keyframe time in seconds |
| `position` | number[2] | No | Position value |
| `rotation` | number | No | Rotation value in degrees |
| `easing` | `"linear"` \| `"ease_in"` \| `"ease_out"` \| `"ease_in_out"` \| `"step"` | No | Easing function |

**Example:**
```json
{
  "command": "add_keyframe2d",
  "params": {
    "entityId": "entity_1",
    "animName": "my_animName",
    "boneName": "my_boneName",
    "time": 1
  }
}
```

Scope: `scene:write` | Token cost: 10

---

### `play_skeletal_animation2d`

Play a skeletal animation on an entity

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Skeleton entity ID |
| `animName` | string | Yes | Animation to play |
| `loop` | boolean | No | Loop the animation |
| `speed` | number | No | Playback speed multiplier |
| `crossfade` | number | No | Crossfade duration in seconds |

**Example:**
```json
{
  "command": "play_skeletal_animation2d",
  "params": {
    "entityId": "entity_1",
    "animName": "my_animName"
  }
}
```

Scope: `scene:write` | Token cost: 5

---

### `set_skeleton2d_skin`

Change the active skin of a skeleton

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Skeleton entity ID |
| `skinName` | string | Yes | Skin to activate |

**Example:**
```json
{
  "command": "set_skeleton2d_skin",
  "params": {
    "entityId": "entity_1",
    "skinName": "my_skinName"
  }
}
```

Scope: `scene:write` | Token cost: 5

---

### `create_ik_chain2d`

Create an IK constraint on a 2D skeleton

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Skeleton entity ID |
| `name` | string | Yes | IK constraint name (accepted as chainName) |
| `bones` | string[] | Yes | Bone chain, root-first: 2 to 64 bone names. Omit to derive the chain from startBone/endBone |
| `targetEntityId` | string | Yes | Target entity ID (UUID string; empty means no target yet) |
| `bendDirection` | number | No | Bend direction (+1 or -1) |
| `mix` | number | No | IK/FK blend (0-1) |
| `startBone` | string | No | Chain root, when bones is omitted |
| `endBone` | string | No | Chain tip, when bones is omitted; its parents are walked up to startBone |

**Example:**
```json
{
  "command": "create_ik_chain2d",
  "params": {
    "entityId": "entity_1",
    "name": "my_name",
    "bones": [
      "entity_1"
    ],
    "targetEntityId": "my_targetEntityId"
  }
}
```

Scope: `scene:write` | Token cost: 15

---

### `get_skeleton2d`

Query skeleton data for an entity

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Skeleton entity ID |

**Example:**
```json
{
  "command": "get_skeleton2d",
  "params": {
    "entityId": "entity_1"
  }
}
```

Scope: `scene:read` | Token cost: 0

---

### `import_skeleton_json`

Import skeleton data from SpawnForge's own skeleton JSON

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Entity to attach skeleton to |
| `jsonData` | string | Yes | Skeleton JSON: an object with a non-empty `bones` array, each bone carrying a unique `name` |
| `format` | `"custom"` | No | Source format. Only 'custom' (SpawnForge's own skeleton JSON) is supported; dragonbones and spine need converting first |

**Example:**
```json
{
  "command": "import_skeleton_json",
  "params": {
    "entityId": "entity_1",
    "jsonData": "my_jsonData"
  }
}
```

Scope: `scene:write` | Token cost: 25

---

### `auto_weight_skeleton2d`

Automatically generate vertex weights for a skeleton mesh (engine-chosen algorithm)

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Skeleton entity ID |

**Example:**
```json
{
  "command": "auto_weight_skeleton2d",
  "params": {
    "entityId": "entity_1"
  }
}
```

Scope: `scene:write` | Token cost: 20

---

### `add_skeleton2d_mesh_attachment`

Add a mesh attachment with vertex weights to a skeleton skin for vertex skinning

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Target skeleton entity |
| `skinName` | string | Yes | Name of the skin to add attachment to |
| `attachmentName` | string | Yes | Name for the new attachment |
| `vertices` | array[] | Yes | Array of [x, y] vertex positions |
| `uvs` | array[] | Yes | Array of [u, v] texture coordinates |
| `triangles` | number[] | Yes | Triangle index array |
| `weights` | object[] | Yes | Array of { bones: string[], weights: number[] } per vertex |

**Example:**
```json
{
  "command": "add_skeleton2d_mesh_attachment",
  "params": {
    "entityId": "entity_1",
    "skinName": "my_skinName",
    "attachmentName": "my_attachmentName",
    "vertices": [],
    "uvs": [],
    "triangles": [],
    "weights": []
  }
}
```

Scope: `scene:write` | Token cost: 30

---

## Modeling

### `enter_edit_mode`

Enter polygon edit mode for an entity

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Entity ID to edit |

**Example:**
```json
{
  "command": "enter_edit_mode",
  "params": {
    "entityId": "entity_1"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `exit_edit_mode`

Exit polygon edit mode

**Example:**
```json
{
  "command": "exit_edit_mode",
  "params": {}
}
```

Scope: `scene:write` | Token cost: 0

---

### `set_selection_mode`

Set vertex/edge/face selection mode

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `mode` | `"vertex"` \| `"edge"` \| `"face"` | Yes | Selection mode |

**Example:**
```json
{
  "command": "set_selection_mode",
  "params": {
    "mode": "vertex"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `mesh_extrude`

Extrude selected faces along normal

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `indices` | number[] | Yes | Indices to extrude |
| `distance` | number | No | Extrude distance (default: 1.0) |
| `direction` | number[3] | No | Extrude direction [x, y, z] (default: [0, 1, 0]) |

**Example:**
```json
{
  "command": "mesh_extrude",
  "params": {
    "indices": []
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `mesh_subdivide`

Subdivide selected faces

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `indices` | number[] | No | Face indices to subdivide (empty = whole mesh) |
| `level` | number | No | Subdivision level (default: 1) |

**Example:**
```json
{
  "command": "mesh_subdivide",
  "params": {}
}
```

Scope: `scene:write` | Token cost: 0

---

### `recalc_normals`

Recalculate mesh normals

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `smooth` | boolean | No | Smooth normals (default: true) |

**Example:**
```json
{
  "command": "recalc_normals",
  "params": {}
}
```

Scope: `scene:write` | Token cost: 0

---

## Security

### `get_security_status`

Get current security configuration status

**Example:**
```json
{
  "command": "get_security_status",
  "params": {}
}
```

Scope: `security:read` | Token cost: 0

---

### `validate_project_security`

Check project for common security issues (suspicious entity names, oversized scripts, injection patterns)

**Example:**
```json
{
  "command": "validate_project_security",
  "params": {}
}
```

Scope: `security:read` | Token cost: 0

---

## Performance

### `set_entity_lod`

Configure LOD (Level of Detail) settings for an entity

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Entity ID to configure LOD for |
| `lodDistances` | number[3] | No | Distance thresholds for LOD1, LOD2, LOD3 [20, 50, 100] |
| `autoGenerate` | boolean | No | Auto-generate LOD meshes |
| `lodRatios` | number[3] | No | Triangle reduction ratios [0.5, 0.25, 0.1] |

**Example:**
```json
{
  "command": "set_entity_lod",
  "params": {
    "entityId": "entity_1"
  }
}
```

Scope: `performance:write` | Token cost: 0

---

### `generate_lods`

Auto-generate LOD meshes for an entity

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Entity ID to generate LODs for |

**Example:**
```json
{
  "command": "generate_lods",
  "params": {
    "entityId": "entity_1"
  }
}
```

Scope: `performance:write` | Token cost: 0

---

### `set_performance_budget`

Set scene performance budget limits

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `maxTriangles` | number | No | Maximum triangle count (default 500,000) |
| `maxDrawCalls` | number | No | Maximum draw calls (default 200) |
| `targetFps` | number | No | Target frame rate (default 60) |
| `warningThreshold` | number | No | Warning threshold 0.0-1.0 (default 0.8) |

**Example:**
```json
{
  "command": "set_performance_budget",
  "params": {}
}
```

Scope: `performance:write` | Token cost: 0

---

### `get_performance_stats`

Get current performance metrics

**Example:**
```json
{
  "command": "get_performance_stats",
  "params": {}
}
```

Scope: `performance:read` | Token cost: 0

---

### `optimize_scene`

Run automatic optimization pass on the scene

**Example:**
```json
{
  "command": "optimize_scene",
  "params": {}
}
```

Scope: `performance:write` | Token cost: 0

---

### `set_lod_distances`

Set global LOD distance thresholds

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `distances` | number[3] | Yes | Global LOD distances [20, 50, 100] |

**Example:**
```json
{
  "command": "set_lod_distances",
  "params": {
    "distances": [
      0,
      0,
      0
    ]
  }
}
```

Scope: `performance:write` | Token cost: 0

---

### `set_simplification_backend`

Select the mesh simplification algorithm used for LOD generation. 'qem' preserves UVs, normals and vertex colors via attribute interpolation. 'fast' uses position-only collapse (faster but destroys texture coordinates).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `backend` | `"qem"` \| `"fast"` | Yes | Simplification backend: 'qem' (attribute-preserving, default) or 'fast' (position-only) |

**Example:**
```json
{
  "command": "set_simplification_backend",
  "params": {
    "backend": "qem"
  }
}
```

Scope: `performance:write` | Token cost: 0

---

## World_building

### `build_world`

Generate a complete, internally consistent game world from a natural-language premise. Produces factions with mutual relationships, regions connected in a traversable graph, a chronological history timeline, discoverable lore entries, and gameplay rules. Applies self-healing validation to fix asymmetric relationships and isolated regions. Falls back to the closest genre preset if all retries fail. Token cost is high due to world size — use sparingly.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `premise` | string | Yes | Natural-language world concept, e.g. 'sci-fi world with 4 factions fighting over energy crystals'. Be specific about tone, conflict, and setting. |
| `genre` | string | No | Optional genre hint. Use a preset key for inspiration: 'medieval_fantasy', 'sci_fi_space', 'post_apocalyptic', 'cyberpunk_city', 'mythological'. Or provide a custom genre string. |
| `factionCount` | integer | No | Desired number of factions (1-10). Default is 3. UI becomes unusable above 10. |
| `regionCount` | integer | No | Desired number of regions (1-20). Default is 5. Graph visualization breaks above 20. |

**Example:**
```json
{
  "command": "build_world",
  "params": {
    "premise": "my_premise"
  }
}
```

Scope: `ai:generate` | Token cost: 3

---

### `get_current_world`

Retrieve the currently generated world data including factions, regions, timeline, lore, and a consistency report. Returns an error if no world has been generated yet.

**Example:**
```json
{
  "command": "get_current_world",
  "params": {}
}
```

Scope: `scene:read` | Token cost: 0

---

### `clear_world`

Clear the currently stored world data. Use before generating a completely new world to avoid stale data.

**Example:**
```json
{
  "command": "clear_world",
  "params": {}
}
```

Scope: `scene:write` | Token cost: 0

---

## Localization

### `extract_translatable_strings`

Scan the current scene and return all user-authored translatable strings (entity names, dialogue text, UI labels) with stable IDs and context metadata. Run this before translate_scene to see what will be translated.

**Example:**
```json
{
  "command": "extract_translatable_strings",
  "params": {}
}
```

Scope: `scene:read` | Token cost: 0

---

### `translate_scene`

Batch-translate all extractable strings in the current scene into one or more target locales using AI. Strings are sent in chunks of 200. Translated bundles are stored and available for export. Variable placeholders (e.g. {playerName}) are preserved.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `targetLocales` | string[] | Yes | BCP-47 locale codes to translate to (e.g. ["ja", "fr", "de", "zh-CN"]). Maximum 10 per call. |
| `sourceLocale` | string | No | Source locale code. Defaults to "en". |

**Example:**
```json
{
  "command": "translate_scene",
  "params": {
    "targetLocales": [
      "entity_1"
    ]
  }
}
```

Scope: `ai:generate` | Token cost: 5

---

### `set_preview_locale`

Switch the editor preview to display strings in a translated locale so you can review the translation in context. Pass null to return to the source locale. Only locales with stored translations can be previewed.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `locale` | string,null | Yes | BCP-47 locale code to preview (e.g. "ja"), or null to return to source text. |

**Example:**
```json
{
  "command": "set_preview_locale",
  "params": {}
}
```

Scope: `scene:write` | Token cost: 0

---

### `list_locales`

List all stored locale translation bundles for the current project, including the string count per locale, the active preview locale, and the full list of supported locale codes.

**Example:**
```json
{
  "command": "list_locales",
  "params": {}
}
```

Scope: `scene:read` | Token cost: 0

---

## Economy

### `design_economy`

Generate a complete, balanced in-game economy from a game description. Returns currencies (with earn rates and sinks), a shop with priced items, loot tables with weighted drops, a progression curve (XP per level and rewards), and a balance validation report. Use the 'preset' parameter to start from a known-good template: 'casual_mobile', 'rpg_classic', 'roguelike', 'idle_incremental', or 'competitive_pvp'. The response includes a balanceScore (0-100), a list of issues (inflation_risk, dead_end_item, unreachable_content, etc.), and ready-to-use JavaScript source code for the economy runtime. Validation errors must be fixed before the economy is suitable for production use.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `gameDescription` | string | Yes | Natural language description of the game — genre, progression feel, player goals. Used to select and tune the economy. Example: 'A fast-paced roguelike where players collect souls and unlock meta-upgrades between runs.' |
| `preset` | `"casual_mobile"` \| `"rpg_classic"` \| `"roguelike"` \| `"idle_incremental"` \| `"competitive_pvp"` | No | Optional starting template. Overrides keyword matching from gameDescription. casual_mobile: single currency, short session. rpg_classic: gold + premium gem dual currency. roguelike: souls meta-progression. idle_incremental: prestige loop with 3 currencies. competitive_pvp: cosmetic-only token shop. |
| `autoInjectScript` | boolean | No | If true, the generated economy JavaScript is automatically added to the project script library as 'economy.js'. Default: false. |

**Example:**
```json
{
  "command": "design_economy",
  "params": {
    "gameDescription": "my_gameDescription"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

## Cutscene

### `generate_cutscene`

AI-generate a cinematic cutscene timeline from a natural-language description. Produces camera movements, entity animations, dialogue cues, and audio tracks. Returns a cutsceneId to use with play_cutscene. Maximum 60 seconds.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `prompt` | string | Yes | Natural-language description of the cutscene, e.g. 'Dramatic pan from sky down to the player, then dialogue between player and the wizard' |
| `duration` | number | No | Desired total duration in seconds (1–60, default 10) |

**Example:**
```json
{
  "command": "generate_cutscene",
  "params": {
    "prompt": "my_prompt"
  }
}
```

Scope: `scene:write` | Token cost: 20

---

### `play_cutscene`

Enter play mode and execute a cutscene timeline. Commands fire at their scheduled timestamps (+/- 16ms). Automatically returns to edit mode when the cutscene ends.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `cutsceneId` | string | Yes | ID of the cutscene to play (returned by generate_cutscene or list_cutscenes) |

**Example:**
```json
{
  "command": "play_cutscene",
  "params": {
    "cutsceneId": "my_cutsceneId"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

### `stop_cutscene`

Stop the currently playing cutscene and return the editor to edit mode. Has no effect if no cutscene is playing.

**Example:**
```json
{
  "command": "stop_cutscene",
  "params": {}
}
```

Scope: `scene:write` | Token cost: 0

---

### `list_cutscenes`

Return all cutscenes saved in the current project, including their IDs, names, durations, and track counts.

**Example:**
```json
{
  "command": "list_cutscenes",
  "params": {}
}
```

Scope: `scene:read` | Token cost: 0

---

### `delete_cutscene`

Permanently delete a cutscene from the project. If the deleted cutscene is currently active, playback is stopped first.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `cutsceneId` | string | Yes | ID of the cutscene to delete |

**Example:**
```json
{
  "command": "delete_cutscene",
  "params": {
    "cutsceneId": "my_cutsceneId"
  }
}
```

Scope: `scene:write` | Token cost: 0

---

## MCP Resources

Resources provide live state without tool calls:

| URI | Name | Description |
|-----|------|-------------|
| `forge://scene/graph` | Scene Graph | Current scene hierarchy with all entities |
| `forge://scene/selection` | Current Selection | Currently selected entity IDs and primary selection |
| `forge://project/info` | Project Info | Project metadata and settings |
| `forge://docs/index` | Documentation Index | Master index of all documentation topics with tags |
| `forge://docs/{path}` | Documentation Page | Individual documentation page by path (e.g., forge://docs/features/physics) |
