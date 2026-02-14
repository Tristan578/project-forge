# CSG Boolean Operations

Combine meshes using union, subtract, and intersect operations.

## Overview
Constructive Solid Geometry (CSG) creates complex shapes by combining simple ones. Place two mesh entities so they overlap, then apply a boolean operation.

## Operations

| Operation | Description | Example |
|-----------|-------------|---------|
| Union | Merge two shapes into one | Two cubes → L-shaped block |
| Subtract | Cut one shape from another | Cube - Sphere → cube with spherical hole |
| Intersect | Keep only the overlapping region | Cube ∩ Sphere → lens shape |

## Using CSG

### Editor UI
1. Position two mesh entities so they overlap
2. Select both entities (Ctrl+click)
3. Right-click → CSG → Union / Subtract / Intersect

### MCP Commands
```json
{"command": "csg_union", "params": {"entityIdA": "entity_1", "entityIdB": "entity_2"}}
{"command": "csg_subtract", "params": {"entityIdA": "entity_1", "entityIdB": "entity_2"}}
{"command": "csg_intersect", "params": {"entityIdA": "entity_1", "entityIdB": "entity_2"}}
```

**Note:** For subtract, entity A is the base shape and entity B is cut from it. Order matters!

## Result
CSG operations create a **new entity** (type: CsgResult) containing the resulting mesh. The original entities are preserved — you can hide or delete them.

## Tips
- CSG works best with **primitive shapes** (cubes, spheres, cylinders) — complex meshes may produce artifacts
- Position shapes to overlap before applying the operation
- The result entity gets a default material — you can change it afterward
- **Subtract** is the most useful for architectural modeling (windows, doors, holes)
- CSG operations support **undo/redo** (including the mesh data)
- Multiple CSG results can be combined with further CSG operations

## Related
- [Procedural Mesh](./procedural-mesh.md) — other mesh generation methods
- [Scene Management](./scene-management.md) — managing CSG entities
- [Materials](./materials.md) — apply materials to CSG results
