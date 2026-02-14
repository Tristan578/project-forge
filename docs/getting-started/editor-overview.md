# Editor Overview

A guide to every panel and control in the Project Forge editor.

## Layout

The editor is divided into these main areas:

```
┌──────────┬──────────────────────────┬──────────────┐
│ Sidebar  │                          │  Right Panel │
│          │     3D Viewport          │  (Inspector/ │
│ [Tools]  │     (Canvas)             │   Chat/      │
│          │                          │   Script)    │
├──────────┤                          │              │
│ Scene    │                          │              │
│Hierarchy │                          │              │
├──────────┴──────────────────────────┴──────────────┤
│              Asset Panel (bottom)                   │
└─────────────────────────────────────────────────────┘
         ┌─ Scene Toolbar (top) ─┐
         │ Save│Load│New│Export  │
         │ Play│Pause│Stop      │
         └──────────────────────┘
```

## Sidebar (Left)

The sidebar contains tool buttons:

| Button | Action | Shortcut |
|--------|--------|----------|
| **+** (Add) | Open spawn menu | — |
| **Move** | Translate gizmo | W |
| **Rotate** | Rotation gizmo | E |
| **Scale** | Scale gizmo | R |
| **Grid** | Toggle snap grid | G |

## Scene Hierarchy

Lists all entities in the scene as a tree. Features:
- **Search** — filter entities by name
- **Drag & drop** — reparent entities in the hierarchy
- **Eye icon** — toggle entity visibility
- **Right-click** — context menu (rename, focus, duplicate, delete)

## 3D Viewport

The main canvas showing your scene. Controls:
- **Left-click** — select entity
- **Right-click drag** — orbit camera
- **Middle-click drag** — pan camera
- **Scroll wheel** — zoom in/out
- **Delete key** — delete selected entity
- **Ctrl+D** — duplicate selected entity
- **Ctrl+Z / Ctrl+Y** — undo / redo

## Right Panel

Three tabs:
- **Inspector** — edit properties of the selected entity (transform, material, light, physics, audio, particles, animation, scripts)
- **Script** — TypeScript code editor for the selected entity's script
- **Chat** — AI assistant for natural-language scene editing (when available)

## Inspector Panel

When an entity is selected, the Inspector shows editable sections:

| Section | Shows When | What You Can Edit |
|---------|-----------|-------------------|
| **Name** | Always | Entity display name |
| **Transform** | Always | Position, rotation, scale (XYZ) |
| **Material** | Meshes | Color, metallic, roughness, emissive, textures, alpha mode, UV transform, clearcoat, transmission |
| **Light** | Lights | Type, color, intensity, range, spot angle |
| **Physics** | When enabled | Body type, collider shape, friction, restitution, gravity scale |
| **Audio** | When enabled | Audio source, volume, pitch, loop, spatial settings |
| **Particles** | When enabled | Presets, spawn rate, emission shape, lifetime, color/size over time |
| **Animation** | glTF models | Clip selection, play/pause/stop, speed, loop, blend weights |
| **Shader** | When applied | Shader effect type and parameters |
| **Terrain** | Terrain entities | Noise type, octaves, frequency, sculpt tools |

## Scene Toolbar (Top)

- **Scene Name** — click to rename
- **Save / Load / New** — file operations
- **Export** — export as standalone HTML game
- **Play / Pause / Stop** — enter/exit play mode to test your game

## Asset Panel (Bottom)

Drag-and-drop area for importing:
- **3D Models** — `.glb` / `.gltf` files
- **Textures** — `.png` / `.jpg` / `.webp` images
- **Audio** — `.mp3` / `.ogg` / `.wav` sound files

Imported assets appear in the grid and can be applied to entities.

## Scene Settings

Access via the gear icon. Configure:
- **Ambient Light** — color and intensity
- **Environment** — clear color (background), distance fog
- **Post-Processing** — bloom, chromatic aberration, color grading, sharpening

## Play Mode

Click **Play** to test your game:
- Physics simulation starts
- Scripts begin executing
- Input bindings become active
- Click **Stop** to return to Edit mode (scene state is restored)
- Click **Pause** to freeze the simulation

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| W | Move tool |
| E | Rotate tool |
| R | Scale tool |
| G | Toggle grid snap |
| Delete | Delete selection |
| Ctrl+D | Duplicate selection |
| Ctrl+Z | Undo |
| Ctrl+Y / Ctrl+Shift+Z | Redo |
| Ctrl+S | Save scene |
| F | Focus on selection |

## Related

- [First Scene](./first-scene.md) — hands-on tutorial
- [Transforms](../features/transforms.md) — detailed transform guide
- [Scene Management](../features/scene-management.md) — entity operations
