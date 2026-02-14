# Input System

Define key bindings and input actions for game controls.

## Overview
The Input System maps keyboard and mouse inputs to named **actions**. During Play mode, scripts read these actions via `forge.input.*`. Four presets provide ready-made configurations for common game types.

## Input Bindings Panel

Open the **Input Bindings** section in the Inspector (when no entity is selected) or via Scene Settings.

### Presets
| Preset | Actions |
|--------|---------|
| FPS | move_forward, move_backward, move_left, move_right, jump, shoot, aim, reload, sprint, crouch |
| Platformer | move_left, move_right, jump, attack, dash, interact |
| Top-Down | move_up, move_down, move_left, move_right, primary_action, secondary_action, interact |
| Racing | accelerate, brake, steer_left, steer_right, boost, reset |

### Rebinding
1. Click on a binding (e.g., "W" next to "move_forward")
2. Press the new key — it captures the input
3. The binding updates immediately

### Custom Actions
Add your own actions with the **+ Add Action** button. Each action has:
- **Name** — the string used in scripts (e.g., "jump")
- **Bindings** — one or more keys/buttons

## MCP Commands
```json
{"command": "set_input_preset", "params": {"preset": "fps"}}

{"command": "set_input_binding", "params": {
  "action": "jump",
  "bindings": ["Space", "GamepadSouth"]
}}

{"command": "add_input_action", "params": {
  "action": "interact",
  "bindings": ["KeyE"]
}}

{"command": "remove_input_action", "params": {"action": "interact"}}
{"command": "get_input_bindings", "params": {}}
```

## Script API
```typescript
// Check if an action is held down
if (forge.input.isPressed("move_forward")) {
  forge.translate(entityId, 0, 0, -5 * forge.time.delta);
}

// Detect single press (e.g., jump)
if (forge.input.justPressed("jump")) {
  forge.physics.applyImpulse(entityId, 0, 8, 0);
}

// Check release (e.g., stop charging)
if (forge.input.justReleased("shoot")) {
  // Fire projectile
}

// Axis value for analog input (-1 to 1)
const steer = forge.input.getAxis("steer_left");  // Returns -1 when pressed, 0 when not
```

## Tips
- Input only reads during **Play mode**
- Presets load a full set of bindings — applying a preset replaces all current bindings
- You can have multiple keys bound to the same action
- Input bindings are saved with the scene
- Action names are case-sensitive — use `snake_case` consistently

## Related
- [Scripting](./scripting.md) — using input in scripts
- [Physics](./physics.md) — physics-based character controllers
