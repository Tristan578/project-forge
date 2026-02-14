# Export

Export your game as a standalone HTML file that runs in any browser.

## Overview
The Export system packages your scene, scripts, assets, and a lightweight runtime engine into a single HTML file. The exported game runs independently — no server required.

## Exporting

### Editor UI
1. Click **Export** in the toolbar
2. The Export Dialog opens with options:
   - **Title** — game title shown in the browser tab
   - **Width / Height** — canvas resolution
3. Click **Export** — a standalone `.html` file downloads

### MCP Commands
```json
{"command": "export_game", "params": {"title": "My Game", "width": 1280, "height": 720}}
{"command": "get_export_status", "params": {}}
```

## What's Included
- Scene entities and their full component data
- TypeScript scripts (bundled and compiled)
- Asset data (textures, audio — embedded as data URLs)
- Physics configuration
- Input bindings
- Environment and post-processing settings
- Lightweight WASM runtime (stripped of editor systems)

## Runtime vs Editor
The exported game uses a **runtime build** of the engine:
- No selection, gizmos, or inspector
- No undo/redo or debug visualization
- No scene hierarchy panel
- Physics, scripts, input, and audio all work normally
- Significantly smaller than the editor WASM binary

## Tips
- Test your game in **Play mode** before exporting — what you see is what gets exported
- Large textures increase the HTML file size — optimize images before importing
- The export is a single file — easy to share, host, or embed
- Audio and textures are embedded as base64 — no external file dependencies

## Related
- [Save & Load](./save-load.md) — saving the editable scene
- [Scripting](./scripting.md) — game logic that runs in exports
- [Physics](./physics.md) — physics in the runtime
- [Audio](./audio.md) — audio in the runtime
