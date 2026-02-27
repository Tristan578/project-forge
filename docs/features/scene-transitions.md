# Scene Transitions

Animated overlays that play between scene loads — including fade, wipe, and instant cuts — for polished level-change moments.

## Overview

Scene Transitions control what the player sees while one scene is unloaded and another is loaded. Rather than a jarring cut, you can fade the screen to black, wipe from one side, or switch instantly. Transitions are triggered from scripts using `forge.scene.load()` and apply a CSS-animated overlay over the game view.

## Using Scene Transitions in the Editor

Transitions are controlled entirely through the script API — there is no separate panel. To set up a level transition:

1. Create at least two scenes in your project using the **Scene Toolbar** (the scene name area at the top of the editor).
2. Attach a script to the entity or trigger that should change the scene (for example, a goal flag with a **Win Condition** component, or a door with a **Trigger Zone**).
3. In the script, call `forge.scene.load()` with the target scene name and your desired transition options.

## Transition Types

| Type | Description |
|---|---|
| `fade` | Fades the screen to a solid color, then fades back in on the new scene |
| `wipe` | A solid panel wipes across the screen from a chosen direction |
| `instant` | No animation — the scene cuts immediately |

## Script API

```typescript
// Load a scene with a fade transition (default black, 0.5s)
forge.scene.load("Level 2");

// Fade to white over 1 second
forge.scene.load("Level 2", {
  type: "fade",
  duration: 1.0,
  color: "#ffffff",
});

// Wipe from the left
forge.scene.load("Boss Room", {
  type: "wipe",
  duration: 0.4,
  direction: "left",
  color: "#000000",
  easing: "ease-in-out",
});

// Instant cut with no animation
forge.scene.load("Game Over", {
  type: "instant",
});

// Restart the current scene (useful for "retry" buttons)
forge.scene.restart();

// Get the name of the currently active scene
const current = forge.scene.getCurrent();

// Get all scene names in the project
const scenes = forge.scene.getAll();
forge.log("Available scenes: " + scenes.join(", "));
```

## Transition Options Reference

| Option | Type | Default | Description |
|---|---|---|---|
| `type` | `'fade' \| 'wipe' \| 'instant'` | `'fade'` | Animation style |
| `duration` | `number` | `0.5` | Total transition time in seconds |
| `color` | `string` | `'#000000'` | CSS color for the overlay |
| `direction` | `'left' \| 'right' \| 'up' \| 'down'` | `'left'` | Wipe direction (wipe type only) |
| `easing` | `'linear' \| 'ease-in' \| 'ease-out' \| 'ease-in-out'` | `'ease-in-out'` | CSS easing for the animation |

## Tips

- Use `forge.scene.getCurrent()` to write a single "return to main menu" script that works regardless of which level the player is on.
- For a retro game feel, use `type: "instant"` — the hard cut actually reads as snappier than a fade on fast-paced games.
- Chain `forge.scene.restart()` into your **Win Condition** or death handler for an instant restart-the-level experience without any additional configuration.
