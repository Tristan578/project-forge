# Command Reference

Complete reference for all 118 MCP commands available in Project Forge.

> This file is auto-generated from `mcp-server/manifest/commands.json`.
> Run `npx tsx docs/scripts/generate-reference.ts` to regenerate.

## Categories

- [Scene](#scene) (14 commands)
- [Materials](#materials) (5 commands)
- [Lighting](#lighting) (2 commands)
- [Environment](#environment) (1 commands)
- [Rendering](#rendering) (2 commands)
- [Editor](#editor) (5 commands)
- [Camera](#camera) (2 commands)
- [History](#history) (2 commands)
- [Query](#query) (11 commands)
- [Runtime](#runtime) (11 commands)
- [Asset](#asset) (5 commands)
- [Scripting](#scripting) (3 commands)
- [Audio](#audio) (19 commands)
- [Particles](#particles) (8 commands)
- [Animation](#animation) (12 commands)
- [Mesh](#mesh) (7 commands)
- [Terrain](#terrain) (4 commands)
- [Export](#export) (2 commands)
- [Documentation](#documentation) (3 commands)

---

## Scene

### `spawn_entity`

Create a new entity in the scene (mesh primitive or light)

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityType` | `"cube"` \| `"sphere"` \| `"plane"` \| `"cylinder"` \| `"cone"` \| `"torus"` \| `"capsule"` \| `"point_light"` \| `"directional_light"` \| `"spot_light"` | Yes | Type of entity to spawn |
| `name` | string | No | Display name (auto-generated if omitted) |
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
| `presetId` | `"default_gray"` \| `"matte_white"` \| `"polished_metal"` \| `"brushed_metal"` \| `"gold"` \| `"plastic"` \| `"wood"` \| `"concrete"` \| `"rubber"` \| `"glass"` \| `"water"` \| `"ceramic"` \| `"car_paint"` \| `"neon_glow"` | Yes | Preset identifier |

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

## Rendering

### `update_post_processing`

Update post-processing visual effects (bloom, chromatic aberration, color grading, sharpening). Send only the effects you want to change.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `bloom` | object | No | Bloom (glow) settings |
| `chromaticAberration` | object | No | Chromatic aberration (color fringe) settings |
| `colorGrading` | object | No | Color grading settings (exposure, temperature, saturation, etc.) |
| `sharpening` | object | No | Contrast adaptive sharpening settings |

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

Toggle debug wireframe rendering of physics colliders

**Example:**
```json
{
  "command": "toggle_debug_physics",
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

### `set_script`

Set or update TypeScript script source on an entity (lifecycle: onStart, onUpdate, onDestroy)

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `entityId` | string | Yes | Entity to attach script to |
| `source` | string | Yes | TypeScript source code with onStart/onUpdate/onDestroy functions |
| `enabled` | boolean | No | Whether script is active (default: true) |

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

**Example:**
```json
{
  "command": "apply_script_template",
  "params": {
    "entityId": "entity_1",
    "template": "character_controller"
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
| `position` | number[2] | Yes | Sculpt center [x, z] in terrain local space |
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

## Documentation

### `search_docs`

Search Project Forge documentation by keyword. Returns ranked results with snippets.

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

## MCP Resources

Resources provide live state without tool calls:

| URI | Name | Description |
|-----|------|-------------|
| `forge://scene/graph` | Scene Graph | Current scene hierarchy with all entities |
| `forge://scene/selection` | Current Selection | Currently selected entity IDs and primary selection |
| `forge://project/info` | Project Info | Project metadata and settings |
| `forge://docs/index` | Documentation Index | Master index of all documentation topics with tags |
| `forge://docs/{path}` | Documentation Page | Individual documentation page by path (e.g., forge://docs/features/physics) |
