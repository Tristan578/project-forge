# Build an FPS Game

A step-by-step tutorial to create a first-person shooter from scratch.

## What You'll Build
A simple FPS where the player moves through a level, collects items, and shoots targets.

## Step 1: Set Up the Level

### Create the Ground
The default scene includes a ground plane. Scale it up for a larger play area:
1. Select the ground plane
2. Set Scale to [20, 1, 20] in the Inspector

### Add Walls
1. Spawn cubes for walls: **+** → Cube
2. Scale and position them to form corridors:
   - Wall: Position [10, 1.5, 0], Scale [0.5, 3, 20]
   - Wall: Position [-10, 1.5, 0], Scale [0.5, 3, 20]
3. Set their material to a dark color (e.g., gray)

### Add Cover Objects
Spawn additional cubes and cylinders for obstacles and cover.

## Step 2: Configure Input

1. Open Input Bindings
2. Select the **FPS** preset — this gives you:
   - WASD for movement
   - Space for jump
   - Mouse buttons for shoot/aim
   - Shift for sprint

Or via MCP:
```json
{"command": "set_input_preset", "params": {"preset": "fps"}}
```

## Step 3: Add Physics

### Player Entity
1. Spawn a Capsule for the player body
2. Add Physics: Body Type = **Dynamic**, Collider = **Capsule**
3. Lock rotation axes (prevent tumbling):
```json
{"command": "set_physics", "params": {
  "entityId": "player_entity",
  "bodyType": "dynamic",
  "colliderShape": "capsule",
  "friction": 0.5,
  "lockRotationX": true,
  "lockRotationY": true,
  "lockRotationZ": true
}}
```

### Ground & Walls
Set all environment objects to **Static** body type so the player can't fall through.

## Step 4: Player Movement Script

Select the player capsule and add this script:

```typescript
const MOVE_SPEED = 8;
const JUMP_FORCE = 6;

function onUpdate(dt: number) {
  // Movement
  if (forge.input.isPressed("move_forward")) {
    forge.physics.applyForce(entityId, 0, 0, -MOVE_SPEED);
  }
  if (forge.input.isPressed("move_backward")) {
    forge.physics.applyForce(entityId, 0, 0, MOVE_SPEED);
  }
  if (forge.input.isPressed("move_left")) {
    forge.physics.applyForce(entityId, -MOVE_SPEED, 0, 0);
  }
  if (forge.input.isPressed("move_right")) {
    forge.physics.applyForce(entityId, MOVE_SPEED, 0, 0);
  }

  // Jump
  if (forge.input.justPressed("jump")) {
    forge.physics.applyImpulse(entityId, 0, JUMP_FORCE, 0);
  }
}
```

## Step 5: Add Collectibles

1. Spawn several spheres around the level
2. Make them emissive (golden glow):
```json
{"command": "update_material", "params": {"entityId": "collectible_1", "baseColor": [1,0.8,0,1], "emissive": [1,0.8,0,2]}}
```
3. Add the **Collectible** script template — it rotates and destroys on overlap

## Step 6: Add Targets

1. Spawn cubes as targets
2. Add Physics (Dynamic) so they react to hits
3. Set a red material for visibility

## Step 7: Lighting & Atmosphere

1. Adjust the directional light for dramatic shadows
2. Add a few point lights near corridors:
```json
{"command": "set_environment", "params": {"clearColor": [0.05, 0.05, 0.1, 1.0], "fogEnabled": true, "fogColor": [0.1, 0.1, 0.15, 1.0], "fogStart": 10, "fogEnd": 50}}
```
3. Enable Bloom in post-processing for glowing collectibles

## Step 8: Test & Export

1. Press **Play** to test
2. Move with WASD, jump with Space
3. When satisfied, click **Export** for a standalone HTML game

## Tips
- Use `forge.state` to track score across scripts
- Add particle effects (sparks, explosions) to collectibles for juice
- Test frequently in Play mode — iterate fast!

## Related
- [Physics](../features/physics.md) — physics system details
- [Scripting](../features/scripting.md) — script API reference
- [Input System](../features/input-system.md) — input configuration
- [Export](../features/export.md) — exporting your game
