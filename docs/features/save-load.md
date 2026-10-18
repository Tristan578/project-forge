# Save & Load

Save scenes as `.forge` files, auto-save to browser storage, and manage cloud projects.

## Overview
SpawnForge uses a JSON-based `.forge` file format for scene persistence. Scenes can be saved locally, auto-saved to browser localStorage, or stored in the cloud (with an account).

## Saving Scenes

### Editor UI
- **Ctrl+S** or click **Save** in the toolbar — downloads a `.forge` file
- Auto-save to localStorage happens periodically

### MCP Commands
```json
{"command": "save_scene", "params": {"name": "My Level"}}
{"command": "export_scene_data", "params": {}}
```

## Loading Scenes

### Editor UI
Click **Load** in the toolbar and select a `.forge` file.

### MCP Commands
```json
{"command": "load_scene", "params": {"sceneData": "..."}}
```

## New Scene
Start fresh with a default scene:
```json
{"command": "new_scene", "params": {}}
```

## .forge File Format
The `.forge` file is a JSON document containing:
- Scene name and metadata
- All entities with their components (transforms, materials, lights, physics, audio, scripts, particles, etc.)
- Asset references
- Input bindings
- Environment settings
- Post-processing settings
- The project's dimension, 2D or 3D (see below)
- The scene's completion mode, when one has been chosen (see below)

### Project type (2D or 3D)
Whether the project is 2D or 3D. In 2D mode the engine renders through an orthographic 2D camera — the only camera sprites are visible through — and the editor shows the 2D inspector sections and the tilemap tools. It is set by the AI (`set_project_type`), by a generated game's brief, or by loading a 2D template.

It is stored as `metadata.projectType`, `"2d"` or `"3d"`, inside the `.forge` file. The engine writes it on every save from its own project-type state, and on every load applies the type the file states, so it travels with the scene everywhere the scene goes: the `.forge` download, auto-save, cloud save, scene switching, checkpoints, the publication snapshot a `/play` link serves, remixes, forks and the HTML/ZIP exports. A scene created inside a project (Scene Browser, the AI's `create_scene`, a generated game's first scene) states the project's current type from the start. After every load the engine reports the type now in force to the editor, so a reopened 2D project comes back with its 2D tools available without an AI turn (#10227).

**Rule for files without the key.** A file with no `metadata.projectType` — every scene saved before the key existed, at any `formatVersion`, and any scene written without one — does not change the project's type when it is loaded: the engine keeps whatever type the session is in, and reports that type. So switching to such a scene inside a 2D project keeps the project 2D, as does restoring an auto-save, restoring a checkpoint or importing an older `.forge` file mid-session. Opened cold — a fresh editor or `/play` session — the engine starts in 3D, so such a file comes up 3D, exactly as before the key existed; it gains the key on its next save. (A 2D game published before the key existed therefore still plays in 3D until it is republished; tracked in #10368.) An explicit `null` counts as no key. A value that is not `"2d"` or `"3d"` is refused by the engine as an invalid scene file, in the same way as any other unknown value in the format; the type is never guessed from the entities. No `formatVersion` change: the key is optional, and a bump would be refused by every engine already deployed.

### Completion mode
How the game counts as complete: `win`, `endless`, `sandbox` or `narrative`. It is set from **Scene Settings → Completion mode** or by the AI (`set_completion_mode`, or a generated game's brief), and it decides whether **Play** and orchestrator verification require a win condition. Only `win` requires one; a win condition the scene does have is validated in every mode.

It is stored as an optional top-level `completionMode` key of the `.forge` file. The engine ignores the key, so it needs no `formatVersion` change, and every save path carries it: the `.forge` download, auto-save, cloud save, scene switching and checkpoints.

**Undo and redo.** Scene Settings has dedicated completion-mode Undo/Redo buttons. In-app AI uses `undo` or `redo` with `scope: "completion_mode"` to step the same history. Omitting the scope retains engine entity history; an empty completion-mode history returns an error without undoing an unrelated entity edit.

**Migration rule for older files.** A file with no `completionMode` key, at any `formatVersion`, is a `win` game. It opens in win mode, keeps the win-condition requirement it always had, and re-saves without gaining the key, so nothing is added and nothing is dropped. A value that is not one of the four modes is read as `win` and logged as a warning. The mode is never guessed from entity names.

## Auto-Save
The editor auto-saves to browser localStorage every 30 seconds. If you close and reopen, your last session is restored.

## Cloud Storage
With a SpawnForge account, scenes save to the cloud:
- Automatic cloud sync
- Access from any device
- Project dashboard for managing scenes

## Tips
- `.forge` files are human-readable JSON — you can inspect or edit them in a text editor
- Auto-save is browser-local — clearing browser data loses auto-saved work
- Save frequently to `.forge` files for reliable backups
- All entity state is preserved: transforms, materials, physics config, scripts, audio settings, particle settings, and more

## Related
- [Export](./export.md) — exporting as a playable game
- [Scene Management](./scene-management.md) — what's in a scene
