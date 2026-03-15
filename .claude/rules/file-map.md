# Project File Map

## Engine Structure (`engine/src/`)

### `bridge/` — JS Interop (ONLY module that touches `web_sys`/`js_sys`/`wasm_bindgen`)
- `mod.rs` — `#[wasm_bindgen]` exports + `SelectionPlugin::build()` orchestrator (~450 lines). References domain module systems via module paths
- `events.rs` — `emit_event()` + ~20 typed emit functions. Thread-local `RefCell` storage
- `core_systems.rs` — Selection, picking, mode changes, transforms, rename, snap, quality presets, scene graph/history emit
- `material.rs` — Material/light emit, environment, skybox, post-processing, shader apply/sync
- `physics.rs` — 3D + 2D physics, collisions, raycasts, joints, forces, debug toggle
- `audio.rs` — Audio updates/removals/playback, bus CRUD, reverb zones
- `query.rs` — Query request processing (main, terrain, quality, reverb zone, joints)
- `animation.rs` — GLTF animation registration, playback, state polling
- `particles.rs` — Particle apply/toggle/removal/preset, Hanabi GPU sync (webgpu)
- `scene_io.rs` — Scene export/load, new scene, GLTF import, texture load, asset placement
- `procedural.rs` — CSG boolean ops, extrude, lathe
- `mesh_ops.rs` — Array entity, combine meshes, prefab instantiation
- `scripts.rs` — Script updates/removals, input bindings, play tick
- `game.rs` — Game component CRUD, game camera, camera shake
- `skeleton2d.rs` — 2D skeletal animation: bones, skins, IK, keyframes, auto-weight

### `core/` — Pure Rust, Platform-Agnostic (NO browser deps)

#### `core/commands/` — Command dispatch (split into domain modules)
| File | Purpose |
|------|---------|
| `mod.rs` | `dispatch()` chain, `CommandResponse`, `CommandResult`, shared helpers |
| `transform.rs` | Spawn, delete, duplicate, rename, reparent, camera, gizmo, snap, input |
| `material.rs` | Material, light, ambient, environment, post-processing, skybox, shaders |
| `physics.rs` | Physics 3D, joints, physics 2D, forces, raycasts |
| `audio.rs` | Audio, buses, reverb zones |
| `animation.rs` | Animation playback, speed, loop, blend |
| `particles.rs` | Particle system, presets, playback |
| `procedural.rs` | CSG, terrain, extrude, lathe, array, combine, prefab, quality |
| `scene.rs` | Scene export/load, GLTF import, textures, assets, scripts |
| `game.rs` | Game components, game camera |
| `sprites.rs` | Project type, sprites, camera 2D, skeleton 2D |

#### `core/pending/` — Thread-local command queue (split into domain modules)
| File | Purpose |
|------|---------|
| `mod.rs` | `PendingCommands` struct (fields only), `EntityType`, `with_pending` helper, re-exports |
| `transform.rs` | Transform, rename, spawn, delete, duplicate, selection, camera, snap requests |
| `material.rs` | Material, lighting, environment, post-processing, shader, skybox requests |
| `physics.rs` | Physics 3D, 2D, joints, forces, raycasts requests |
| `audio.rs` | Script, audio, bus, reverb zone requests |
| `animation.rs` | Animation, animation clips, skeleton 2D requests |
| `particles.rs` | Particle system requests |
| `procedural.rs` | CSG, terrain, extrude, lathe, array, combine requests |
| `game.rs` | Game component, game camera, input binding requests |
| `sprites.rs` | Sprite, 2D camera, project type requests |
| `scene.rs` | Scene, assets, prefab, quality requests |
| `query.rs` | `QueryRequest` enum |

#### Other core files
| File | Purpose |
|------|---------|
| `csg.rs` | CSG booleans via `csgrs`. `CsgMeshData`, `CsgOperation` enum |
| `terrain.rs` | Procedural terrain. `TerrainData`/`TerrainMeshData`/`TerrainEnabled` |
| `procedural_mesh.rs` | Extrude, lathe, combine. `ProceduralMeshData`/`ProceduralOp` |
| `entity_factory.rs` | Spawn/delete/duplicate with undo. `EntitySnapshot`, `spawn_from_snapshot` |
| `history.rs` | `UndoableAction` (29 variants), `HistoryStack`, `EntitySnapshot` |
| `entity_id.rs` | `EntityId`, `EntityName`, `EntityVisible` |
| `gizmo.rs` | Transform gizmo. `GizmoTarget` + `group_targets=true` |
| `camera.rs` | `bevy_panorbit_camera`. `yaw`/`pitch`/`radius` |
| `material.rs` | `MaterialData` synced to `StandardMaterial` via `MeshMaterial3d` |
| `lighting.rs` | `LightData` (Point/Directional/Spot) |
| `environment.rs` | `EnvironmentSettings` (ClearColor + `DistanceFog`) |
| `engine_mode.rs` | `EngineMode` (Edit/Play/Paused), `EditorSystemSet`, `PlaySystemSet`, snapshot/restore |
| `input.rs` | `InputMap`/`InputState`, `InputPreset`, `capture_input` |
| `physics.rs` | `PhysicsData`/`PhysicsEnabled`, `manage_physics_lifecycle` |
| `audio.rs` | `AudioData`/`AudioEnabled` (metadata — playback is JS-side) |
| `scripting.rs` | `ScriptData` (metadata — execution is JS-side Web Worker) |
| `post_processing.rs` | `PostProcessingSettings` (Bloom, ChromAb, ColorGrade, Sharpen) |
| `particles.rs` | `ParticleData`/`ParticleEnabled`, 9 presets |
| `asset_manager.rs` | `AssetRef`, `AssetRegistry`, `TextureHandleMap` |
| `scene_file.rs` | `SceneName`, `.forge` format serialization |

## Web Structure (`web/src/`)

### Stores
- `editorStore.ts` — Composition root: creates store from domain slices (~134 lines)
- `stores/slices/` — Domain state slices (16 files: selection, sceneGraph, transform, material, lighting, physics, audio, animation, particle, script, game, sprite, history, scene, asset + types)
- `chatStore.ts` — `rightPanelTab`, chat messages, token balance
- `userStore.ts` — Tier, token balance, permissions (`canUseAI`, `canUseMCP`, `canPublish`)

### Editor Components (`components/editor/`)
EditorLayout, SceneHierarchy, InspectorPanel, MaterialInspector, LightInspector, PhysicsInspector, AudioInspector, ParticleInspector, TerrainInspector, AudioMixerPanel, SceneSettings, InputBindingsPanel, ScriptEditorPanel, PlayControls, SceneToolbar, ExportDialog, AssetPanel, Sidebar, CanvasArea, ContextMenu, Vec3Input, AnimationInspector, DrawerPanel, MobileToolbar, WelcomeModal, KeyboardShortcutsPanel

### Key Hooks
- `useEngine.ts` — WASM loading singleton (WebGPU detect, fallback)
- `useEngineEvents.ts` — Event delegation hub (~85 lines), delegates to `hooks/events/` domain handlers
- `hooks/events/` — Domain event handlers (8 files: transform, material, physics, audio, animation, game, sprite, particle)
- `useResponsiveLayout.ts` — Layout mode from viewport breakpoints (compact/condensed/full)
- `useViewport.ts` — Canvas dimensions, DPR, breakpoint detection
- `useVirtualList.ts` — Lightweight virtual scrolling hook

### Libraries (`lib/`)
- `chat/executor.ts` — Handler registry dispatcher (~49 lines), delegates to `chat/handlers/`
- `chat/executor.legacy.ts` — Legacy fallback (unmigrated handlers)
- `chat/handlers/` — Domain tool handlers (transform, material, query + types/helpers)
- `chat/context.ts` — Scene context for AI
- `scripting/` — Web Worker sandbox, forge.* API types, templates
- `audio/` — Web Audio API manager (spatial, per-entity nodes)
- `export/` — Export pipeline (scriptBundler, assetPackager, gameTemplate)
- `projects/` — Cloud project CRUD, tier-based limits
- `auth/` — Clerk helpers, user DB sync
- `tokens/` — Token balance/deduction
- `keys/` — BYOK key resolution, AES-256-GCM encryption
- `db/` — Drizzle + Neon client, DB schema

### MCP Server (`mcp-server/`)
- `manifest/commands.json` — 322 commands across 37 categories
- `src/manifest.test.ts` — Schema validation (update `validCategories` when adding categories)
- `src/docs/` — Doc loader, BM25 search, MCP resource/tool registration

## Communication Pattern

**JS -> Rust:** `editorStore` slice action -> `dispatchCommand()` -> `handle_command()` -> `commands::dispatch()` chain -> domain `dispatch()` -> `pending/` queue -> Bevy drains next frame

**Rust -> JS:** Bevy system -> `emit_event()` -> JS callback -> `useEngineEvents` -> domain event handler -> Zustand `set()` -> React re-render

**Audio/Scripts:** Rust stores metadata (`AudioData`, `ScriptData`) as ECS components. JS handles execution (Web Worker for scripts, Web Audio API for audio)

**Particles:** `ParticleData`/`ParticleEnabled` always compiled. WebGPU: `bevy_hanabi` GPU rendering. WebGL2: data stored, not rendered
