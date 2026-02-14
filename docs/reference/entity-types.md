# Entity Types

Reference for all entity types and their available components.

## Mesh Primitives

| Type | Description | Default Size |
|------|-------------|-------------|
| Cube | Box mesh | 1×1×1 |
| Sphere | UV sphere | Radius 0.5 |
| Plane | Flat quad | 2×2 |
| Cylinder | Cylindrical mesh | Radius 0.5, Height 1 |
| Cone | Conical mesh | Radius 0.5, Height 1 |
| Torus | Ring/donut mesh | Major 0.5, Minor 0.15 |
| Capsule | Pill shape | Radius 0.5, Height 1 |

**Available components:** Transform, Material, Physics, Audio, Script, Particles, Shader Effect

## Light Types

| Type | Description | Key Properties |
|------|-------------|---------------|
| Point Light | Omnidirectional | Color, Intensity, Range, Shadows |
| Directional Light | Parallel rays | Color, Intensity, Shadows |
| Spot Light | Focused cone | Color, Intensity, Range, Inner/Outer Angle, Shadows |

**Available components:** Transform (position/rotation), Light properties

## Special Types

| Type | Created By | Description |
|------|-----------|-------------|
| GltfModel | Asset import | Imported 3D model with meshes and animations |
| CsgResult | CSG operations | Mesh created by boolean union/subtract/intersect |
| Terrain | Terrain spawn | Procedural heightmap mesh |
| ExtrudedMesh | Extrude operation | Mesh from 2D profile extrusion |
| LathedMesh | Lathe operation | Mesh from profile revolution |
| ArrayEntity | Array operation | Pattern-generated entity |
| CombinedMesh | Combine operation | Merged mesh from multiple entities |

## Component Summary

| Component | Description | Applies To |
|-----------|-------------|-----------|
| Transform | Position, rotation, scale | All entities |
| Material | PBR surface appearance | Meshes |
| Light | Light emission properties | Lights |
| Physics | Rigid body + collider | Any entity |
| Audio | Sound source | Any entity |
| Script | TypeScript game logic | Any entity |
| Particles | GPU particle system | Any entity |
| Shader Effect | Custom visual shader | Meshes |
| Animation | Skeletal animation | glTF models |
| Terrain Data | Noise parameters | Terrain entities |

## Spawning

Spawn via sidebar **+** button, context menu, or MCP:
```json
{"command": "spawn_entity", "params": {"entityType": "sphere", "name": "Ball", "position": [0, 2, 0]}}
{"command": "spawn_terrain", "params": {"name": "Ground", "resolution": 64}}
```

## Related
- [Scene Management](../features/scene-management.md) — entity operations
- [Materials](../features/materials.md) — mesh appearance
- [Lighting](../features/lighting.md) — light configuration
