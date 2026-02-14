# Asset Pipeline

Import 3D models, textures, and audio files into your project.

## Overview
The Asset Panel at the bottom of the editor manages imported files. Drag and drop files to import, then apply them to entities.

## Supported Formats

| Type | Formats | Used For |
|------|---------|----------|
| 3D Models | `.glb`, `.gltf` | Meshes, animations, embedded textures |
| Textures | `.png`, `.jpg`, `.webp` | Material texture maps |
| Audio | `.mp3`, `.ogg`, `.wav` | Sound effects, music |

## Importing Assets

### Drag & Drop
1. Drag files from your file system into the **Asset Panel**
2. Assets appear in the grid with thumbnail previews
3. Each asset gets a unique ID (e.g., `asset_001`)

### MCP Commands
```json
{"command": "import_gltf", "params": {"url": "data:...", "name": "Character"}}
{"command": "import_texture", "params": {"url": "data:...", "name": "Wood", "slot": "base_color"}}
{"command": "import_audio", "params": {"url": "data:...", "name": "Explosion"}}
```

## Applying Assets

### 3D Models
Imported glTF models spawn as entities with their meshes, materials, and animations intact.

### Textures
1. Select a mesh entity
2. In the Material Inspector, click a texture slot
3. Choose the imported texture

```json
{"command": "set_material_texture", "params": {"entityId": "entity_1", "slot": "base_color", "assetId": "asset_001"}}
```

### Audio
1. Select an entity
2. Enable Audio in the Inspector
3. Select the imported audio asset

```json
{"command": "set_audio", "params": {"entityId": "entity_1", "assetId": "audio_001"}}
```

## Managing Assets
```json
{"command": "list_assets", "params": {}}
{"command": "delete_asset", "params": {"assetId": "asset_001"}}
```

## Tips
- glTF Binary (`.glb`) is preferred — it bundles meshes, textures, and animations in one file
- Textures are converted to data URLs for embedding — large textures increase save file size
- Audio files are stored as references — keep source files accessible
- Assets are included in scene exports

## Related
- [Materials](./materials.md) — using textures in materials
- [Animation](./animation.md) — glTF animation playback
- [Audio](./audio.md) — using audio assets
- [Export](./export.md) — assets in exported games
