# GenForge Documentation

Welcome to GenForge — an AI-powered platform for creating 2D/3D games in your browser.

## Getting Started

New to GenForge? Start here:

- [Installation & Setup](./getting-started/installation.md) — prerequisites, build, first run
- [Your First Scene](./getting-started/first-scene.md) — create a scene step by step
- [Editor Overview](./getting-started/editor-overview.md) — UI panels, navigation, shortcuts

## Features

Detailed guides for every editor capability:

### Scene & Objects
- [Scene Management](./features/scene-management.md) — spawn, delete, duplicate, rename, hierarchy
- [Transforms](./features/transforms.md) — move, rotate, scale, snapping, gizmos

### Appearance
- [Materials](./features/materials.md) — PBR workflow, textures, alpha modes, presets
- [Lighting](./features/lighting.md) — point, directional, spot lights, ambient, fog
- [Custom Shaders](./features/custom-shaders.md) — dissolve, hologram, force field, lava, toon, fresnel
- [Post-Processing](./features/post-processing.md) — bloom, chromatic aberration, color grading

### Simulation
- [Physics](./features/physics.md) — rigid bodies, colliders, forces, gravity
- [Particles](./features/particles.md) — GPU particle effects, 9 presets
- [Animation](./features/animation.md) — skeletal animation, crossfade, blending

### Scripting & Input
- [Scripting](./features/scripting.md) — TypeScript game logic, forge.* API
- [Input System](./features/input-system.md) — key bindings, presets, rebinding

### Audio
- [Audio](./features/audio.md) — playback, spatial 3D, mixer, buses, effects

### World Building
- [Terrain](./features/terrain.md) — procedural heightmap terrain, sculpting
- [Procedural Mesh](./features/procedural-mesh.md) — extrude, lathe, array, combine
- [CSG Booleans](./features/csg-booleans.md) — union, subtract, intersect

### Gameplay Systems
- [Game Components](./features/game-components.md) — drag-and-drop behaviors (CharacterController, Health, Collectible, etc.)
- [Dialogue System](./features/dialogue-system.md) — dialogue trees, branching conversations, conditions & actions
- [Game Cameras](./features/game-cameras.md) — 6 camera modes (third-person, first-person, side-scroller, top-down, fixed, orbital)
- [Scene Transitions](./features/scene-transitions.md) — fade, wipe, instant transitions between scenes
- [Game Templates](./features/game-templates.md) — 5 starter templates for quick prototyping
- [Physics Joints](./features/physics-joints.md) — fixed, revolute, spherical, prismatic, rope, spring joints

### Advanced
- [Keyframe Animation](./features/keyframe-animation.md) — position, rotation, scale, color keyframes with easing
- [Skybox & Environment](./features/skybox-environment.md) — procedural skyboxes, IBL presets
- [Visual Scripting](./features/visual-scripting.md) — node-based scripting with 73 node types
- [AI Asset Generation](./features/ai-asset-generation.md) — generate 3D models, textures, audio, and skyboxes with AI
- [Cloud Publishing](./features/cloud-publishing.md) — publish games to shareable URLs
- [Prefabs](./features/prefabs.md) — reusable entity templates, import/export
- [Multi-Scene](./features/multi-scene.md) — multiple scenes per project, scene switching

### Assets & Files
- [Asset Pipeline](./features/asset-pipeline.md) — import glTF, textures, audio
- [Save & Load](./features/save-load.md) — .forge files, auto-save, cloud storage
- [Export](./features/export.md) — standalone HTML game export

## API Documentation

- [REST API (Swagger UI)](./api/openapi.json) — interactive API documentation at `/api-docs`

## Tutorials

End-to-end game building guides:

- [Build an FPS Game](./guides/build-fps-game.md) — first-person shooter tutorial
- [Build a Platformer](./guides/build-platformer.md) — side-scrolling platformer tutorial
- [AI Workflow](./guides/ai-workflow.md) — using MCP/AI to build games
- [MCP Server Setup](./guides/mcp-server-setup.md) — connect external AI agents via the MCP server

## Reference

- [Command Reference](./reference/commands.md) — all 329 MCP commands with parameters
- [Script API](./reference/script-api.md) — complete forge.* TypeScript API
- [Entity Types](./reference/entity-types.md) — all entity types and components
- [Known Limitations](./known-limitations.md) — features that are UI-only or partially implemented
