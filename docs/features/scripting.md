# Scripting

Add game logic using TypeScript scripts with the `forge.*` API.

## Overview
Each entity can have a TypeScript script that runs during Play mode. Scripts execute in a Web Worker sandbox with access to the `forge.*` API for transforms, physics, input, audio, particles, and more.

## Adding a Script

### Editor UI
1. Select an entity
2. Switch to the **Script** tab in the right panel
3. Write TypeScript code or select a template
4. Press **Play** to test

### MCP Commands
```json
{"command": "set_script", "params": {
  "entityId": "entity_1",
  "source": "function onUpdate(dt: number) {\n  forge.rotate(entityId, 0, 90 * dt, 0);\n}",
  "enabled": true
}}
```

## Script Lifecycle

Three lifecycle functions:
```typescript
function onStart(): void {
  // Called once when Play mode starts
  forge.log("Script started!");
}

function onUpdate(dt: number): void {
  // Called every frame. dt = seconds since last frame
  forge.translate(entityId, 0, 0, -5 * dt);
}

function onDestroy(): void {
  // Called when Play mode stops
  forge.log("Script cleaned up");
}
```

The global `entityId` variable contains the ID of the entity the script is attached to.

## Script Templates

4 built-in templates:

| Template | Description |
|----------|-------------|
| Character Controller | WASD movement + jump with physics |
| Collectible | Rotating object that destroys on contact |
| Rotating Object | Continuous Y-axis rotation |
| Follow Camera | Camera that follows a target entity |

## forge.* API Reference

### Core
```typescript
forge.getTransform(entityId)  // Get position, rotation, scale
forge.setPosition(entityId, x, y, z)
forge.setRotation(entityId, x, y, z)
forge.translate(entityId, dx, dy, dz)
forge.rotate(entityId, dx, dy, dz)
forge.spawn(type, { name, position })  // Returns new entity ID
forge.destroy(entityId)
forge.log(message)
forge.warn(message)
forge.error(message)
```

### Input
```typescript
forge.input.isPressed(action)      // Held down this frame
forge.input.justPressed(action)    // First frame of press
forge.input.justReleased(action)   // First frame of release
forge.input.getAxis(action)        // -1 to 1 value
```

### Physics
```typescript
forge.physics.applyForce(entityId, fx, fy, fz)
forge.physics.applyImpulse(entityId, fx, fy, fz)
forge.physics.setVelocity(entityId, vx, vy, vz)
```

### Audio
```typescript
forge.audio.play(entityId)
forge.audio.stop(entityId)
forge.audio.setVolume(entityId, volume)
forge.audio.playOneShot(assetId, { position, bus, volume })
```

### Particles
```typescript
forge.particles.setPreset(entityId, preset)
forge.particles.enable(entityId)
forge.particles.disable(entityId)
forge.particles.burst(entityId)
```

### Animation
```typescript
forge.animation.play(entityId, clipName, crossfadeSecs)
forge.animation.pause(entityId)
forge.animation.stop(entityId)
forge.animation.setSpeed(entityId, speed)
forge.animation.setBlendWeight(entityId, clipName, weight)
```

### Time
```typescript
forge.time.delta    // Seconds since last frame
forge.time.elapsed  // Seconds since Play started
```

### State (shared between scripts)
```typescript
forge.state.set("score", 100)
const score = forge.state.get("score")
```

## Console Output
The Script panel includes a console that shows `forge.log()`, `forge.warn()`, and `forge.error()` output. Use this for debugging during Play mode.

## Tips
- Scripts only run in **Play mode** — edit in Edit mode, test in Play mode
- Each entity has its own script instance — `entityId` is unique per script
- Use `forge.time.delta` to make movement frame-rate independent
- `forge.state` lets scripts communicate (e.g., a collectible updates a score that the UI reads)
- Scripts are undoable — changes to script content support undo/redo

## Related
- [Input System](./input-system.md) — binding keys to actions
- [Physics](./physics.md) — physics API
- [Audio](./audio.md) — audio API
- [Particles](./particles.md) — particle API
