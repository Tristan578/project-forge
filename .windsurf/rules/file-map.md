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
- `manifest/commands.json` — 351 commands across 41 categories (measured: `bash .claude/tools/validate-mcp.sh sync`; pinned by `web/src/lib/config/__tests__/capabilityMatrix.test.ts`)
- `src/docs/` — Doc loader, BM25 search

### Docs Site (`apps/docs/`)

Deploys with `rootDirectory: apps/docs`, so nothing above `apps/docs/` exists on Vercel. Every repo-root artifact the site needs has an in-root copy under `apps/docs/data/`, loaded by **static import** — a runtime `readFileSync` from a `__dirname`-derived path is invisible to Next.js output file tracing and is what 500'd `/mcp` in production (#9718).

- `data/commands.json` — copy of `mcp-server/manifest/commands.json` (guarded by `scripts/check-manifest-sync.ts`)
- `data/capability-matrix.json` — `{ source, lines[] }` generated from `docs/capability-matrix.md` by `scripts/sync-capability-matrix.ts` (`npm run sync:capability-matrix` at the repo root). Never hand-edit; the docs gate and the web gate both fail on a stale copy
- `lib/capabilityMatrix.ts` — parser for the markdown subset the matrix is written in, plus `readCapabilityMatrix()` over the statically imported JSON
- `components/CapabilityMatrixDocument.tsx` — server-renderable renderer for `/capability-matrix`: `#` is the page h1 and `##` the h2 (no skipped level), the row-key column is `<th scope="row">`, every header cell `<th scope="col">`, each scrolling table wrapper is a focusable `role="region"`

## Communication Pattern

**JS → Rust:** editorStore action → `dispatchCommand()` → `handle_command()` → pending queue → Bevy drains next frame

**Rust → JS:** Bevy system → `emit_event()` → JS callback → `useEngineEvents` → Zustand `set()` → React re-render
