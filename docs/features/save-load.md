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
- The scene's completion mode, when one has been chosen (see below)

### Completion mode
How the game counts as complete: `win`, `endless`, `sandbox` or `narrative`. It is set from **Scene Settings → Completion mode** or by the AI (`set_completion_mode`, or a generated game's brief), and it decides whether **Play** and orchestrator verification require a win condition. Only `win` requires one; a win condition the scene does have is validated in every mode.

It is stored as an optional top-level `completionMode` key of the `.forge` file. The engine ignores the key, so it needs no `formatVersion` change, and every save path carries it: the `.forge` download, auto-save, cloud save, scene switching and checkpoints.

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
