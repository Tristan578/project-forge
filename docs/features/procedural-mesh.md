# Procedural Mesh Generation

Create meshes programmatically using extrude, lathe, array, and combine operations.

## Overview
Generate meshes from mathematical descriptions rather than importing 3D models. Useful for architectural elements, mechanical parts, and repetitive structures.

## Extrude

Extrudes a 2D profile shape along an axis to create a 3D mesh.

### Available Shapes
- **Circle** — creates a cylinder/tube
- **Square** — creates a box/beam
- **Hexagon** — creates a hexagonal prism
- **Star** — creates a star-shaped prism

### MCP Commands
```json
{"command": "extrude_shape", "params": {
  "name": "Pillar",
  "shape": "circle",
  "radius": 0.5,
  "height": 3.0,
  "segments": 16,
  "position": [0, 1.5, 0]
}}
```

## Lathe

Revolves a 2D profile around the Y-axis to create a surface of revolution (vases, goblets, columns).

### MCP Commands
```json
{"command": "lathe_shape", "params": {
  "name": "Vase",
  "points": [[0.5, 0], [0.7, 0.5], [0.4, 1.5], [0.3, 2.0], [0.35, 2.5]],
  "segments": 24,
  "position": [0, 0, 0]
}}
```

The `points` array defines the 2D profile as [radius, height] pairs. The profile is revolved around the Y-axis.

## Array

Create patterns of entities in grid or circular arrangements.

### Grid Array
```json
{"command": "array_entity", "params": {
  "entityId": "entity_1",
  "pattern": "grid",
  "countX": 5,
  "countY": 1,
  "countZ": 5,
  "spacingX": 2.0,
  "spacingY": 0.0,
  "spacingZ": 2.0
}}
```

### Circular Array
```json
{"command": "array_entity", "params": {
  "entityId": "entity_1",
  "pattern": "circle",
  "count": 8,
  "radius": 5.0
}}
```

## Combine Meshes

Merge multiple mesh entities into a single entity:
```json
{"command": "combine_meshes", "params": {
  "entityIds": ["entity_1", "entity_2", "entity_3"],
  "name": "Combined Structure"
}}
```

## Parameters Reference

### Extrude
| Parameter | Description |
|-----------|-------------|
| shape | circle, square, hexagon, star |
| radius | Profile radius |
| height | Extrusion length |
| segments | Subdivision count (more = smoother) |

### Lathe
| Parameter | Description |
|-----------|-------------|
| points | Array of [radius, height] profile points |
| segments | Revolution subdivisions |

### Array
| Parameter | Description |
|-----------|-------------|
| pattern | "grid" or "circle" |
| countX/Y/Z | Copies per axis (grid) |
| count | Total copies (circle) |
| spacingX/Y/Z | Distance between copies (grid) |
| radius | Arrangement radius (circle) |

## Tips
- Array creates independent copies — modify the original and re-array for changes
- Lathe profiles should start from the bottom (Y=0) and go up
- Combine merges geometry permanently — use undo if you need to separate again
- All procedural operations support **undo/redo**

## Related
- [CSG Booleans](./csg-booleans.md) — boolean operations on meshes
- [Materials](./materials.md) — apply materials to procedural meshes
- [Scene Management](./scene-management.md) — managing generated entities
