# Materials

Control the appearance of mesh entities with PBR (Physically Based Rendering) materials.

## Overview
Every mesh entity has a material defining its visual appearance. Project Forge uses the metallic-roughness PBR workflow, which simulates realistic lighting interactions.

## Core Properties

| Property | Range | Description |
|----------|-------|-------------|
| Base Color | RGBA | The main color/albedo of the surface |
| Metallic | 0–1 | 0 = dielectric (plastic, wood), 1 = metal |
| Roughness | 0–1 | 0 = mirror-smooth, 1 = completely rough |
| Emissive | RGB + Intensity | Self-illumination (glowing materials) |
| Reflectance | 0–1 | Fresnel reflectance at normal incidence |

## Editor UI

1. Select a mesh entity
2. Open the **Material** section in the Inspector
3. Adjust sliders and color pickers
4. Changes apply in real-time

## Texture Maps

Apply image textures to material slots:
1. Import a texture via the Asset Panel (drag & drop)
2. In the Material Inspector, click a texture slot
3. Select the imported texture

| Slot | Purpose |
|------|---------|
| Base Color Texture | Albedo/diffuse map |
| Normal Map | Surface detail without geometry |
| Metallic/Roughness | Per-pixel metallic & roughness |
| Emissive Texture | Glow map |
| Occlusion Texture | Ambient occlusion |

## Alpha Modes

| Mode | Description |
|------|-------------|
| Opaque | No transparency (default) |
| Mask | Binary transparency (alpha cutoff threshold) |
| Blend | Smooth transparency (glass, water) |

## Extended Material Properties

| Property | Range | Description |
|----------|-------|-------------|
| UV Offset | X, Y | Shift texture coordinates |
| UV Scale | X, Y | Tile/repeat textures |
| Clearcoat | 0–1 | Clear lacquer layer (car paint, varnished wood) |
| Clearcoat Roughness | 0–1 | Roughness of the clearcoat layer |
| Transmission | 0–1 | Light passing through (glass, water) |
| IOR | 1.0–3.0 | Index of refraction (1.5 = glass) |
| Parallax Depth | 0–0.1 | Parallax occlusion mapping depth |

## Material Presets

14 built-in presets for quick setup:
- Default, Polished Metal, Brushed Steel, Gold, Copper
- Plastic, Rubber, Wood, Marble, Glass
- Emissive Glow, Ceramic, Fabric, Ice

## MCP Commands
```json
{"command": "update_material", "params": {
  "entityId": "entity_1",
  "baseColor": [1.0, 0.0, 0.0, 1.0],
  "metallic": 0.9,
  "roughness": 0.1,
  "emissive": [0.0, 0.0, 0.0, 0.0]
}}

{"command": "set_material_preset", "params": {
  "entityId": "entity_1",
  "preset": "polished_metal"
}}

{"command": "update_material_extended", "params": {
  "entityId": "entity_1",
  "uvOffsetX": 0.0,
  "uvOffsetY": 0.0,
  "uvScaleX": 2.0,
  "uvScaleY": 2.0,
  "clearcoat": 0.8,
  "transmission": 0.0,
  "ior": 1.5
}}

{"command": "set_material_texture", "params": {
  "entityId": "entity_1",
  "slot": "base_color",
  "assetId": "texture_001"
}}
```

## Tips
- Metallic and roughness together define the "feel" — low roughness + high metallic = chrome; high roughness + low metallic = clay
- Emissive materials glow but don't cast light — pair with a point light for illumination
- Texture UV Scale > 1 tiles the texture; < 1 stretches it
- Alpha Blend materials should be used sparingly — they're more expensive to render

## Related
- [Custom Shaders](./custom-shaders.md) — advanced shader effects
- [Post-Processing](./post-processing.md) — screen-space effects
- [Asset Pipeline](./asset-pipeline.md) — importing textures
- [Lighting](./lighting.md) — how light interacts with materials
