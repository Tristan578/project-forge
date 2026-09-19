# Bridge Isolation Rules

The SpawnForge engine enforces a hard boundary between platform-agnostic Rust
(`core/`) and browser-specific code (`bridge/`). Violating this boundary breaks
native compilation and server-side testing.

## The Law

```
engine/src/
├── core/       ZERO browser deps. Compiles on any Rust target.
└── bridge/     ONLY module allowed to import web_sys / js_sys / wasm_bindgen.
```

The architecture validator (`python3 .claude/skills/arch-validator/check_arch.py`)
enforces this on every Edit/Write via the post-edit hook.

## What Is Allowed Where

### core/ — Pure Rust

Allowed:
- `std::*` (except `std::fs`, `std::net`, `std::thread` — no WASM equivalents)
- `serde`, `serde_json`
- `bevy::prelude::*` (bevy ECS, math, assets — NOT bevy::render render-pipeline types)
- `csgrs`, `noise`, `rand` (pure compute)

Forbidden:
- `web_sys` — DOM/browser APIs
- `js_sys` — JavaScript built-ins
- `wasm_bindgen` — JS interop derives
- `gloo_*` — browser utilities
- `std::fs`, `std::net`, `std::thread` — unavailable on wasm32

### bridge/ — Browser Interop

Allowed (in addition to everything core/ allows):
- `web_sys`
- `js_sys`
- `wasm_bindgen` / `wasm_bindgen::prelude::*`
- `serde_wasm_bindgen`
- `bevy::render` render-pipeline types (for GPU resource creation)

## Communication Pattern

```
JS → Rust:  handle_command(json) → core/commands/dispatch() → pending queue
Rust → JS:  bridge emit_event() → JS callback → Zustand store → React
```

Never reach across the boundary from core/ toward bridge/. The pending queue is
the only handoff point.

## Bridge Module Responsibilities

| File | Responsibility |
|------|---------------|
| `bridge/mod.rs` | `#[wasm_bindgen]` exports, `SelectionPlugin::build()` orchestrator |
| `bridge/events.rs` | `emit_event()` + typed emit functions, thread-local RefCell storage |
| `bridge/core_systems.rs` | Selection, picking, mode changes, transforms, rename, scene graph |
| `bridge/material.rs` | Material/light emit, environment, skybox, post-processing |
| `bridge/physics.rs` | 3D + 2D physics, joints, forces, raycasts, debug toggle |
| `bridge/audio.rs` | Audio playback metadata, bus CRUD, reverb zones |
| `bridge/query.rs` | Query request processing |
| `bridge/animation.rs` | GLTF animation registration, playback, polling |
| `bridge/particles.rs` | Hanabi GPU particle sync (webgpu feature only) |
| `bridge/scene_io.rs` | Scene export/load, GLTF import, texture load |
| `bridge/procedural.rs` | CSG booleans, extrude, lathe |
| `bridge/mesh_ops.rs` | Array entity, combine meshes, prefab instantiation |
| `bridge/scripts.rs` | Script metadata updates, input bindings, play tick |
| `bridge/game.rs` | Game component CRUD, game camera, camera shake |
| `bridge/skeleton2d.rs` | 2D skeletal animation — bones, skins, IK, keyframes |

## Adding a New Bridge Module

1. Create `engine/src/bridge/<domain>.rs`
2. Add `pub mod <domain>;` in `bridge/mod.rs`
3. Register systems in `SelectionPlugin::build()` in `bridge/mod.rs`
4. Gate particle/GPU rendering code with `#[cfg(feature = "webgpu")]`

## The runtime Feature

The `runtime` feature strips editor-only systems for the exported game binary.
Gate system *registrations* in `bridge/mod.rs`, NOT function definitions:

```rust
// CORRECT — gate the registration
#[cfg(not(feature = "runtime"))]
app.add_systems(Update, my_editor_only_system);

// WRONG — gating the function definition breaks runtime builds
#[cfg(not(feature = "runtime"))]
fn my_editor_only_system(...) { ... }
```

## Checking the Boundary

```bash
# Architecture validator (fast)
python3 .claude/skills/arch-validator/check_arch.py

# Full WASM compile check
bash .claude/skills/rust-engine/scripts/cargo-check-wasm.sh

# Full validation suite
bash .claude/tools/validate-rust.sh check
```
