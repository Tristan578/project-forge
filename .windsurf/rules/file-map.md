# Project File Map

## Engine Structure (`engine/src/`)

### `bridge/` — JS Interop (ONLY module that touches `web_sys`/`js_sys`/`wasm_bindgen`)
- `mod.rs` — `#[wasm_bindgen]` exports + `SelectionPlugin::build()` orchestrator
- `events.rs` — `emit_event()` + typed emit functions
- `core_systems.rs` — Selection, picking, mode changes, transforms, rename, snap
- `material.rs` — Material/light emit, environment, skybox, post-processing, shader
- `physics.rs` — 3D + 2D physics, collisions, raycasts, joints
- `audio.rs` — Audio updates/removals/playback, bus CRUD
- `query.rs` — Query request processing
- `animation.rs` — GLTF animation registration, playback
- `particles.rs` — Particle system sync
- `scene_io.rs` — Scene export/load, GLTF import
- `procedural.rs` — CSG boolean ops, extrude, lathe
- `mesh_ops.rs` — Array entity, combine meshes, prefab
- `scripts.rs` — Script updates/removals
- `game.rs` — Game component CRUD, game camera
- `skeleton2d.rs` — 2D skeletal animation

### `core/` — Pure Rust, Platform-Agnostic (NO browser deps)
- `core/commands/` — Command dispatch (domain modules)
- `core/pending/` — Thread-local command queue (domain modules)

## Web Structure (`web/src/`)

### Stores
- `editorStore.ts` — Composition root from domain slices
- `stores/slices/` — 16 domain state slice files
- `chatStore.ts` — Chat messages, token balance
- `userStore.ts` — Tier, permissions

### Key Hooks
- `useEngine.ts` — WASM loading singleton (WebGPU detect, fallback)
- `useEngineEvents.ts` — Event delegation hub
- `hooks/events/` — Domain event handlers (8 files)

### Libraries (`lib/`)
- `chat/executor.ts` — Handler registry dispatcher
- `chat/handlers/` — Domain tool handlers
- `scripting/` — Web Worker sandbox
- `audio/` — Web Audio API manager
- `export/` — Export pipeline
- `db/` — Drizzle + Neon client

### MCP Server (`mcp-server/`)
- `manifest/commands.json` — 322 commands across 37 categories
- `src/docs/` — Doc loader, BM25 search

## Communication Pattern

**JS → Rust:** editorStore action → `dispatchCommand()` → `handle_command()` → pending queue → Bevy drains next frame

**Rust → JS:** Bevy system → `emit_event()` → JS callback → `useEngineEvents` → Zustand `set()` → React re-render
