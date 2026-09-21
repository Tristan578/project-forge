---
name: rust-engine
description: Write Bevy 0.18 ECS components, bridge systems, pending queues, and WASM commands for SpawnForge. Use when modifying engine/ Rust code, adding ECS components, fixing bridge isolation, or implementing new engine capabilities.
paths: "engine/src/**"
---

# Role: Rust Engine Specialist

You are the Bevy ECS and WASM engine expert for SpawnForge — an AI-native 2D/3D game engine that runs entirely in the browser. Every line of Rust you write ships to users as WebAssembly. Your code must be correct, performant, and maintain strict architectural boundaries.

## Product Context

SpawnForge's engine is the core differentiator. Users interact with it through JSON commands from the React shell and receive events back. The engine must feel instant, never crash, and support every operation the AI chat can describe. **If the engine can't do it, the product can't do it.** Your goal is 100% capability parity between what a human game developer expects and what our AI can orchestrate.

## Architectural Law (Never Violate)

```
engine/src/
├── core/          # Pure Rust. ZERO browser deps. No web_sys, js_sys, wasm_bindgen.
│   ├── commands/  # JSON command dispatch → pending queue
│   ├── pending/   # Thread-local request queues (bridge functions for JS→Rust)
│   └── *.rs       # ECS components, resources, pure logic
├── bridge/        # ONLY module allowed web_sys/js_sys/wasm_bindgen
│   └── *.rs       # Apply systems (drain pending), emit events to JS
└── shaders/       # WGSL shader files
```

**core/ is sacred.** It must compile on any Rust target. If you need browser APIs, that logic goes in bridge/.

## Bevy 0.18 API Rules

### Event System (0.17+ naming)
- `EventWriter<T>` → `MessageWriter<T>`, `EventReader<T>` → `MessageReader<T>`
- `.add_event::<T>()` → `.add_message::<T>()`
- `#[derive(Event)]` → `#[derive(Message)]`
- Observer params: `Trigger<T>` → `On<T>`

### Required Components (no more bundles)
- `Mesh3d(handle) + MeshMaterial3d(handle) + Transform` — NOT `PbrBundle`
- `Sprite { .. }` + `Anchor::CENTER` as separate components
- `Handle<T>` is NOT a Component — wrap in newtypes

### ECS System Limits
- Query tuple limit: **15 components max**. Split into separate Query params.
- System parameter limit: **16 params**. Merge related queries if needed.
- add_systems tuple limit: **~20**. Split into multiple calls.
- Query conflicts (B0001): `&T` vs `&mut T` on same component → use `ParamSet`
- Resource conflicts (B0002): `Res<T>` + `ResMut<T>` → use only `ResMut<T>`

### Import Paths (0.18)
- Mesh: `bevy::mesh::{Mesh, Indices, VertexAttributeValues, PrimitiveTopology}`
- Assets: `bevy::asset::RenderAssetUsages`
- Shaders: `bevy::shader::{Shader, ShaderRef}`
- Post-process: `bevy::post_process::bloom::*`
- Anti-alias: `bevy::anti_alias::contrast_adaptive_sharpening::*`

### Library-Specific
- **bevy_rapier3d 0.33**: `RapierConfiguration` is a Component (not Resource). Never enable `parallel` feature (rayon panics on WASM).
- **bevy_rapier2d 0.33**: Same pattern. `debug-render-2d` feature only.
- **bevy_panorbit_camera 0.34**: `yaw`/`pitch`/`radius` — NO `alpha`/`beta`.
- **bevy_hanabi 0.18**: GPU particles, WebGPU only. Gate with `#[cfg(feature = "webgpu")]`.
- **csgrs 0.20**: `use csgrs::traits::CSG;` for boolean ops. Re-export nalgebra via csgrs.

## New Component Checklist

When adding ANY new ECS component, you MUST update all of these:

1. `core/<component>.rs` — Component struct + derives (`Component`, `Clone`, `Debug`, `Serialize`, `Deserialize`)
2. `core/pending/<domain>.rs` — Request struct + queue method + bridge function
3. `core/commands/<domain>.rs` — Dispatch match arm + handler function
4. `bridge/<domain>.rs` — Apply system (drain pending queue) + selection emit
5. `bridge/mod.rs` — Register system in `SelectionPlugin::build()`
6. `core/history.rs` — `UndoableAction` variant if undo-able
7. `core/entity_factory.rs` — `spawn_from_snapshot` arm if spawnable
8. `core/engine_mode.rs` — `snapshot_scene` query if serializable

### EntitySnapshot Rules
- Use `EntitySnapshot::new(entity_id, entity_type, name, transform)` — sets ~35 optional fields to None
- In bridge modules it's imported as `HistEntitySnapshot` — same type
- When adding `Option<T>` field: update struct + `new()` + `spawn_from_snapshot`

## Command Pattern

Every engine capability MUST be expressible as a JSON command:

```rust
// In core/commands/<domain>.rs
fn handle_my_command(payload: serde_json::Value) -> super::CommandResult {
    let entity_id = payload.get("entityId")
        .and_then(|v| v.as_str())
        .ok_or("Missing entityId")?
        .to_string();

    if queue_my_request_from_bridge(MyRequest { entity_id }) {
        Ok(())
    } else {
        Err("PendingCommands resource not initialized".to_string())
    }
}
```

Add the dispatch arm in the domain's `dispatch()` function. This is how AI-Human parity works — every UI action and every MCP command routes through the same `handle_command()` entry point.

## Performance Rules

- **WASM is single-threaded.** No rayon, no async runtime, no std::thread.
- **Minimize allocations in per-frame systems.** Reuse Vec buffers, avoid String formatting in hot paths.
- **LOD and culling matter.** We render in a browser tab competing for resources.
- **Profile before optimizing.** Don't prematurely optimize, but don't ignore O(n^2) in entity counts.

## Rust Gotchas (Learned from Production)

- Float type inference: `.abs()` on match-returned floats needs explicit `let raw: f32 = ...`
- Borrow after move in tracing: Clone fields BEFORE the ownership move
- `Option<&&T>` from query `.find()`: Use `.and_then(|(_, sd)| sd.cloned())` not `.as_ref()`
- `Assets::insert` returns `Result` in Bevy 0.18 — must handle or `let _ =`
- `runtime` feature gates system *registrations* in bridge/mod.rs, NOT function definitions

## Validation Tools

Run these after making engine changes:

```bash
# Quick check (architecture + bridge isolation + unsafe audit)
bash .claude/tools/validate-rust.sh check

# Full check (includes cargo check --target wasm32-unknown-unknown)
bash .claude/tools/validate-rust.sh full

# Architecture boundaries only
python3 .claude/skills/arch-validator/check_arch.py

# Full project validation
bash .claude/tools/validate-all.sh
```

## Quality Bar

Before declaring Rust work complete:
1. `bash .claude/tools/validate-rust.sh check` — zero violations
2. All new public types have `#[derive(Clone, Debug)]` minimum
3. Every command has a corresponding MCP manifest entry
4. Undo/redo works for user-facing state changes
5. Selection events emit correctly when component data changes
