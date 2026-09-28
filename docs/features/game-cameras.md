# Game Cameras

Six distinct camera modes that control how the player's view follows or observes the scene during play mode — configurable per-entity with a live shake test.

## Overview

The Game Camera component lets you define exactly how the camera behaves when your game is running. Attach it to any entity (typically the player character or a dedicated camera object), choose a mode, and tune the parameters. Only one camera is active at a time; toggle the **Active** checkbox to designate which entity controls the view.

## Using Game Cameras in the Editor

1. Select any entity in the **Scene Hierarchy**.
2. In the **Inspector Panel**, scroll to the **Game Camera** section.
3. Click **Add Game Camera** if no camera is configured yet.
4. Set **Active** to true to make this the primary camera for play mode.
5. Choose a **Mode** from the dropdown.
6. Set a **Target ID** if you want the camera to follow a specific entity (leave blank to follow whichever entity is currently selected at runtime).
7. Adjust the mode-specific parameters that appear below.
8. Click **Test Shake** to preview a camera shake effect in the editor.

## Camera Modes

### 3rd Person Follow
Follows the target entity from behind and above. The camera eases toward the target each frame rather than snapping to it.

| Property | Description |
|---|---|
| Distance | How far behind the target the camera sits |
| Height | How high above the target the camera floats |
| Smoothing | Follow rate per second (see [Smoothing](#smoothing) below) |

### First Person
Attaches the camera directly to the target entity, creating a first-person view.

| Property | Description |
|---|---|
| Height | Eye height above the entity origin |
| Mouse Sens. | Mouse look sensitivity multiplier |

### Side Scroller
Positions the camera at a fixed distance along the Z axis, tracking the target on X and Y — ideal for 2D side-scrolling levels in a 3D scene.

| Property | Description |
|---|---|
| Distance | Camera distance along the depth axis |
| Smoothing | Follow rate per second (see [Smoothing](#smoothing) below) |

### Top Down
Looks straight down from directly above the target.

| Property | Description |
|---|---|
| Height | Camera altitude above the target |
| Smoothing | Follow rate per second (see [Smoothing](#smoothing) below) |

### Fixed
The camera position is controlled entirely by the entity's Transform. Use the transform gizmo to position and rotate the camera exactly where you want it in the scene.

No additional properties — position and rotation come from the entity's Transform.

### Smoothing
Every mode that follows a target — 3rd Person Follow, Side Scroller and Top Down — shares one **Smoothing** parameter. It is a **rate per second**, not a lag: each frame the camera moves toward the target by `min(smoothing × frameTime, 1)` of the remaining distance. So **higher is snappier** — at the default of 5 the camera closes roughly 8% of the gap per frame at 60fps, at 20 it closes about a third, and at 60 or above it tracks the target exactly. **Lower is floatier**; 0 freezes the camera where it is. Negative values are refused.

### Orbital
The camera orbits around the target at a fixed distance, with optional auto-rotation.

| Property | Description |
|---|---|
| Distance | Orbit radius from the target |
| Auto Rotate | Degrees per second of automatic orbit (0 = no auto-rotation) |

## Script API

```typescript
// Switch camera mode at runtime
forge.camera.setMode("thirdPersonFollow");

// Change the follow target
forge.camera.setTarget("player_entity_id");

// Trigger a camera shake (intensity 0-1, duration in seconds)
forge.camera.shake(0.3, 0.5);

// Read the current mode
const mode = forge.camera.getMode();

// Adjust a camera parameter at runtime
forge.camera.setProperty("followDistance", 8);
forge.camera.setProperty("followSmoothing", 10);
```

## Tips

- For a classic platformer feel, use **3rd Person Follow** with a Distance of 8-12 and a Height of 3. Leave Smoothing at the default 5, or drop it to 3-4 for a floatier camera that trails quick direction changes instead of tracking them exactly; raise it toward 10 only if the camera feels sluggish.
- Camera shake is great for impacts, explosions, or screen-edge feedback. Keep intensity below 0.3 and duration under 0.5 seconds for subtlety.
- Combine **Orbital** mode with an auto-rotate speed of 30-60 for a cinematic presentation camera during menus or loading screens.
