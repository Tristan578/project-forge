# Multi-Scene / Level System

Create and manage multiple named scenes within a single project — switch between them in the editor or load them at runtime for level-based games.

## Overview

The Multi-Scene system lets you build a game with multiple distinct levels, menus, or areas, each as a separate named scene in the same project. All scenes share the same asset library and input bindings. You switch between scenes in the editor using the scene toolbar, and switch at runtime using the `forge.scene.load()` script API.

## Managing Scenes in the Editor

### Renaming the Current Scene
1. Click the scene name displayed in the top toolbar (between the undo/redo buttons and the save icons).
2. The name becomes editable — type a new name and press **Enter** or click away.
3. An asterisk (*) next to the name indicates unsaved changes.

### Saving a Scene
- Click the **Save** icon (floppy disk) in the toolbar, or press **Ctrl+S**.
- If your project is saved to the cloud, a cloud icon in the toolbar shows the save status (green = saved, spinning = saving, red = error).

### Loading a Scene
- Click the **Load** icon (folder) to open a file picker and load a `.forge` scene file.

### Creating a New Scene
- Click the **New Scene** icon (page with plus), or press **Ctrl+Shift+N**.
- If you have unsaved changes, the editor will ask you to confirm before clearing the scene.
- The Template Gallery opens when creating a new project, so you can pick a starting template or a blank scene.

### Exporting a Game
- Click the **Export** icon (download arrow) to open the Export dialog and package your game as a deployable bundle.

## Switching Between Scenes at Runtime

Use `forge.scene` in a script to load, restart, or query scenes during play mode:

```typescript
// Load a different scene (with an optional transition)
forge.scene.load("Level 2");

// Load with a transition effect
forge.scene.load("Boss Arena", {
  type: "fade",
  duration: 0.5,
  color: "#000000",
});

// Restart the current scene (e.g. for a "Try Again" button)
forge.scene.restart();

// Get the name of the currently active scene
const current = forge.scene.getCurrent();

// Get all scene names in the project
const allScenes = forge.scene.getAll();
forge.log("All scenes: " + allScenes.join(", "));
```

See the [Scene Transitions](./scene-transitions.md) guide for the full list of transition options.

## Organizing Multiple Scenes

Since all scenes in a project share one project file, you can:

- Name scenes descriptively: "Main Menu", "Level 1 — Forest", "Level 2 — Cave", "Game Over"
- Use `forge.scene.getAll()` in a menu script to dynamically list available levels
- Keep a "Main Menu" scene with no entities except a UI screen and a script that calls `forge.scene.load()` on button press

## Tips

- Save frequently when switching between scenes — each scene is independent, and unsaved work in one is not affected by switching, but will be lost if you close the browser without saving.
- Put your shared UI (like a HUD overlay) in every scene as a separate entity with its script. Since prefabs can be placed in multiple scenes, use a prefab for any entity that repeats across levels.
- Use `forge.scene.getCurrent()` in a save/load script to record which level the player reached, then call `forge.scene.load(savedSceneName)` to restore their progress.
