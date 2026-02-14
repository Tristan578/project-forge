# Build a Platformer

A step-by-step tutorial to create a 2D-style platformer with physics.

## What You'll Build
A side-scrolling platformer where a character jumps between platforms, avoids obstacles, and collects items.

## Step 1: Set Up the Camera

Position the camera for a side view:
```json
{"command": "set_camera", "params": {"yaw": 0, "pitch": 0, "radius": 20}}
```

## Step 2: Create Platforms

1. Spawn planes or cubes for platforms
2. Scale them as flat rectangles: Scale [4, 0.3, 2]
3. Position at different heights:
   - Ground: Position [0, 0, 0], Scale [20, 0.3, 2]
   - Platform 1: Position [5, 2, 0], Scale [3, 0.3, 2]
   - Platform 2: Position [-3, 4, 0], Scale [4, 0.3, 2]
   - Platform 3: Position [8, 6, 0], Scale [3, 0.3, 2]
4. Add **Static** physics to all platforms

## Step 3: Configure Input

Select the **Platformer** preset:
```json
{"command": "set_input_preset", "params": {"preset": "platformer"}}
```

This gives you: move_left, move_right, jump, attack, dash, interact.

## Step 4: Create the Player

1. Spawn a Capsule for the player
2. Position above the ground: [0, 1, 0]
3. Add Dynamic physics with a Capsule collider
4. Lock Z-axis translation (keep in 2D plane) and all rotations

```json
{"command": "set_physics", "params": {
  "entityId": "player",
  "bodyType": "dynamic",
  "colliderShape": "capsule",
  "friction": 0.3,
  "lockTranslationZ": true,
  "lockRotationX": true,
  "lockRotationY": true,
  "lockRotationZ": true
}}
```

## Step 5: Player Script

```typescript
const SPEED = 6;
const JUMP_FORCE = 8;
let canJump = true;

function onUpdate(dt: number) {
  // Horizontal movement
  if (forge.input.isPressed("move_left")) {
    forge.physics.setVelocity(entityId,
      -SPEED,
      forge.getTransform(entityId)?.position[1] ?? 0,
      0
    );
  }
  if (forge.input.isPressed("move_right")) {
    forge.physics.applyForce(entityId, SPEED, 0, 0);
  }

  // Jump
  if (forge.input.justPressed("jump") && canJump) {
    forge.physics.applyImpulse(entityId, 0, JUMP_FORCE, 0);
    canJump = false;
  }

  // Simple ground check (reset jump when low velocity)
  const t = forge.getTransform(entityId);
  if (t && Math.abs(t.position[1]) < 0.2) {
    canJump = true;
  }
}
```

## Step 6: Add Collectibles

1. Spawn small spheres as coins
2. Apply gold emissive material
3. Add the **Collectible** template script
4. Track score with `forge.state.set("coins", count)`

## Step 7: Add Hazards

1. Spawn red cubes as spike traps
2. Position them between platforms
3. Add Sensor physics (detects overlap without collision)

## Step 8: Polish

- Add **particles** (MagicSparkle) to collectibles
- Set up **post-processing** (bloom for glowing items)
- Configure **environment** (colorful background, no fog)
- Add background **audio** (music on loop)

## Step 9: Test & Export

Press **Play** and test your platformer. Export when ready.

## Related
- [Physics](../features/physics.md) — physics configuration
- [Scripting](../features/scripting.md) — script API
- [Particles](../features/particles.md) — visual effects
- [Audio](../features/audio.md) — sound design
