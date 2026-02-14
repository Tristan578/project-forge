# Transforms

Move, rotate, and scale entities using gizmos, the Inspector, or commands.

## Overview
Every entity has a Transform with three components:
- **Position** (X, Y, Z) — location in 3D space
- **Rotation** (X, Y, Z) — orientation in euler degrees
- **Scale** (X, Y, Z) — size multiplier per axis

## Gizmo Tools

| Tool | Shortcut | Description |
|------|----------|-------------|
| Move | W | Drag arrows to translate |
| Rotate | E | Drag rings to rotate |
| Scale | R | Drag handles to scale |

### Coordinate Modes
- **Local** — axes align to the entity's own orientation
- **World** — axes align to the global coordinate system
Toggle with the coordinate mode button in the sidebar.

## Snapping
Press **G** or click the grid icon to toggle snapping:
- Move snaps to grid increments (default: 1 unit)
- Rotate snaps to degree increments (default: 15°)
- Scale snaps to fixed increments (default: 0.25)

## Inspector Panel
The Transform section in the Inspector shows numeric XYZ fields. You can:
- Type exact values
- Click and drag to scrub values
- Right-click to reset to default
- Copy/paste transforms between entities

## MCP Commands
```json
{"command": "update_transform", "params": {
  "entityId": "entity_1",
  "position": [3.0, 1.0, 0.0],
  "rotation": [0.0, 45.0, 0.0],
  "scale": [2.0, 2.0, 2.0]
}}

{"command": "set_snap_settings", "params": {
  "enabled": true,
  "translateSnap": 0.5,
  "rotateSnap": 10.0,
  "scaleSnap": 0.1
}}

{"command": "set_gizmo_mode", "params": {"mode": "rotate"}}
{"command": "set_coordinate_mode", "params": {"mode": "local"}}
```

## Script API
```typescript
// Get current transform
const t = forge.getTransform(entityId);
// t = { position: [0, 1, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }

// Set absolute position
forge.setPosition(entityId, 3, 1, 0);

// Set absolute rotation (euler degrees)
forge.setRotation(entityId, 0, 45, 0);

// Translate relative to current position
forge.translate(entityId, 0, 0.1 * forge.time.delta, 0);

// Rotate relative to current rotation
forge.rotate(entityId, 0, 90 * forge.time.delta, 0);
```

## Tips
- Hold **Shift** while using gizmos for finer control
- Transform changes are **undoable** — single operations and multi-entity transforms
- Multi-entity transforms: select multiple entities and they transform together
- Camera presets (Top, Front, Right, Perspective) help with precise positioning

## Related
- [Scene Management](./scene-management.md) — entity operations
- [Physics](./physics.md) — physics-driven movement
- [Input System](./input-system.md) — input-driven movement
