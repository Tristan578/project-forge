# Procedural Terrain

Generate heightmap-based terrain with noise algorithms and sculpting tools.

## Overview
Create landscape terrain procedurally using noise functions. Terrain generates a height map mesh with automatic vertex coloring based on elevation (green lowlands → brown hills → white peaks).

## Creating Terrain

### Editor UI
Click **+** in the sidebar → **Terrain** to spawn a terrain entity.

### MCP Commands
```json
{"command": "spawn_terrain", "params": {
  "name": "Landscape",
  "resolution": 64,
  "size": 50.0,
  "noiseType": "perlin",
  "seed": 42,
  "octaves": 4,
  "frequency": 0.03,
  "amplitude": 8.0,
  "persistence": 0.5,
  "lacunarity": 2.0
}}
```

## Noise Types

| Type | Description |
|------|-------------|
| Perlin | Classic smooth noise — rolling hills |
| Simplex | Smoother variant with fewer artifacts |
| Value | Blocky noise — good for plateaus |

## Terrain Parameters

| Parameter | Range | Description |
|-----------|-------|-------------|
| Resolution | 8–256 | Vertices per side (higher = more detail) |
| Size | > 0 | World-space width/depth |
| Noise Type | perlin/simplex/value | Algorithm for height generation |
| Seed | integer | Random seed (same seed = same terrain) |
| Octaves | 1–8 | Layers of detail (more = more complex) |
| Frequency | > 0 | Feature density (higher = more hills) |
| Amplitude | > 0 | Maximum height |
| Persistence | 0–1 | How much each octave contributes |
| Lacunarity | > 0 | Frequency multiplier between octaves |

## Terrain Inspector

The Terrain Inspector in the right panel shows:
- Noise parameter sliders (real-time preview)
- Resolution selector
- Sculpt tools

## Sculpting

Shape terrain by hand with sculpt tools:

| Tool | Description |
|------|-------------|
| Raise | Push terrain up under the brush |
| Lower | Push terrain down |
| Flatten | Level terrain to a target height |
| Smooth | Blur height differences |

### MCP Commands
```json
{"command": "sculpt_terrain", "params": {
  "entityId": "entity_1",
  "tool": "raise",
  "x": 25.0,
  "z": 25.0,
  "radius": 5.0,
  "strength": 2.0
}}
```

## Updating Terrain Parameters
```json
{"command": "update_terrain", "params": {
  "entityId": "entity_1",
  "frequency": 0.05,
  "amplitude": 12.0,
  "octaves": 6
}}
```

## Tips
- Higher **resolution** means more vertices — 128+ can impact performance
- Low **frequency** + high **amplitude** = large rolling hills; high frequency + low amplitude = rough surface
- Use **Flatten** tool to create level areas for buildings or paths
- **Smooth** tool removes harsh edges from sculpting
- Terrain supports **undo/redo** for both parameter changes and sculpting
- Terrain data is saved in `.forge` files (including sculpt modifications)

## Related
- [Materials](./materials.md) — terrain uses vertex coloring by default
- [Physics](./physics.md) — add a static collider for walkable terrain
- [Scene Management](./scene-management.md) — terrain as an entity
