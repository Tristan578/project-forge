# Physics

Add realistic physics simulation with rigid bodies, colliders, forces, and constraints.

## Overview
Project Forge uses the Rapier physics engine for real-time 3D physics. Physics runs only during **Play mode** — in Edit mode, you configure physics properties; in Play mode, they simulate.

## Enabling Physics

### Editor UI
1. Select an entity
2. In the Inspector, click **Add Physics** (or toggle the physics section)
3. Choose a body type and collider shape

### MCP Commands
```json
{"command": "set_physics", "params": {
  "entityId": "entity_1",
  "bodyType": "dynamic",
  "colliderShape": "cuboid",
  "restitution": 0.5,
  "friction": 0.3,
  "density": 1.0
}}
```

## Body Types

| Type | Description | Use For |
|------|-------------|---------|
| Dynamic | Fully simulated — affected by gravity and forces | Players, projectiles, debris |
| Static | Immovable — collides with dynamic bodies | Ground, walls, platforms |
| Kinematic | Moved by code — pushes dynamic bodies | Moving platforms, doors |

## Collider Shapes

| Shape | Description |
|-------|-------------|
| Cuboid | Box collider (matches entity scale) |
| Sphere | Ball collider |
| Capsule | Pill-shaped (good for characters) |
| Cylinder | Cylindrical collider |
| Auto (Trimesh) | Matches the exact mesh geometry |

## Physics Properties

| Property | Range | Description |
|----------|-------|-------------|
| Restitution | 0–1 | Bounciness (0 = no bounce, 1 = perfect bounce) |
| Friction | 0–1 | Surface friction (0 = ice, 1 = sandpaper) |
| Density | > 0 | Mass density (affects weight) |
| Gravity Scale | any | Multiplier on gravity (0 = weightless, 2 = double gravity) |
| Is Sensor | bool | Detects overlaps without physical collision |
| Lock Axes | flags | Prevent rotation/translation on specific axes |

## Script API
```typescript
// Apply continuous force (every frame)
forge.physics.applyForce(entityId, 0, 10, 0);

// Apply instant impulse (one-time push)
forge.physics.applyImpulse(entityId, 0, 5, 0);

// Set velocity directly
forge.physics.setVelocity(entityId, 0, 0, -5);
```

## Debug Visualization
Enable physics debug wireframes to see collider shapes:
```json
{"command": "set_debug_physics", "params": {"enabled": true}}
```

## Gravity
Set global gravity (default: [0, -9.81, 0]):
```json
{"command": "set_gravity", "params": {"gravity": [0, -15.0, 0]}}
```

## Tips
- Physics only runs in **Play mode** — press Play to test
- Set the ground plane to **Static** body type so objects land on it
- Use **Kinematic** bodies for objects you move via script — they push dynamic bodies without being pushed back
- **Sensors** are great for trigger zones (detect when player enters an area)
- All physics changes support **undo/redo**

## Related
- [Scripting](./scripting.md) — script-driven forces and movement
- [Input System](./input-system.md) — input-driven character control
- [Transforms](./transforms.md) — manual positioning
