# Scene Management

Manage entities in your scene: spawn, delete, duplicate, rename, organize in hierarchies, and search.

## Overview
Every object in Project Forge is an **entity** — meshes, lights, cameras, and more. The Scene Hierarchy panel shows all entities as a tree structure.

## Spawning Entities

### Editor UI
Click **+** in the sidebar to open the spawn menu. Available entity types:
- **Primitives**: Cube, Sphere, Plane, Cylinder, Cone, Torus, Capsule
- **Lights**: Point Light, Directional Light, Spot Light

### MCP Commands
```json
{"command": "spawn_entity", "params": {"entityType": "sphere", "name": "Ball", "position": [0, 2, 0]}}
```

## Deleting Entities

### Editor UI
Select an entity and press **Delete**, or right-click → Delete.

### MCP Commands
```json
{"command": "despawn_entity", "params": {"entityId": "entity_1"}}
{"command": "delete_entities", "params": {"entityIds": ["entity_1", "entity_2"]}}
```

## Duplicating Entities
Select and press **Ctrl+D**, or right-click → Duplicate. The copy spawns with a slight offset.

```json
{"command": "duplicate_entity", "params": {"entityId": "entity_1"}}
```

## Renaming Entities
Double-click an entity name in the Hierarchy, or use the name field in the Inspector.

```json
{"command": "rename_entity", "params": {"entityId": "entity_1", "name": "Player"}}
```

## Scene Hierarchy
- **Drag & drop** to reparent entities (create parent-child relationships)
- **Search bar** filters entities by name
- **Eye icon** toggles visibility
- **Context menu** (right-click) for quick actions

### MCP Commands
```json
{"command": "reparent_entity", "params": {"entityId": "entity_2", "parentId": "entity_1"}}
{"command": "set_visibility", "params": {"entityId": "entity_1", "visible": false}}
{"command": "select_entity", "params": {"entityId": "entity_1"}}
```

## Querying the Scene
```json
{"command": "get_scene_graph", "params": {}}
{"command": "get_entity_info", "params": {"entityId": "entity_1"}}
{"command": "get_selection", "params": {}}
```

## Tips
- All spawn/delete/rename operations support **undo/redo** (Ctrl+Z / Ctrl+Y)
- Entity IDs are stable — they survive undo/redo and save/load
- The hierarchy supports multi-select (Ctrl+click)

## Related
- [Transforms](./transforms.md) — positioning entities
- [Materials](./materials.md) — appearance
- [Save & Load](./save-load.md) — persisting scenes
