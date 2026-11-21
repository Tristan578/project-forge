# SpawnForge Architecture Rules

## The Three-Layer Sandwich

```
┌─────────────────────────────────────────────────────────────┐
│  React Shell (Next.js 16, Zustand, Tailwind)                │
│  web/src/                                                    │
│  - Editor UI, AI chat, inspector panels                     │
│  - Communicates DOWN via handle_command() JSON calls        │
│  - Receives events UP via JS callback from bridge           │
├─────────────────────────────────────────────────────────────┤
│  Bevy Editor Engine (Rust → WASM)                           │
│  engine/src/                                                 │
│  - Scene graph, ECS, rendering (WebGPU/WebGL2)              │
│  - Receives commands, emits events                          │
│  - Sub-layers: core/ (pure Rust) + bridge/ (JS interop)    │
├─────────────────────────────────────────────────────────────┤
│  Game Runtime + TypeScript Scripting                        │
│  - Web Worker sandbox for user scripts                      │
│  - forge.* API surface for game logic                       │
│  - Physics/animation channels to WASM handle_command()      │
└─────────────────────────────────────────────────────────────┘
```

---

## Bridge Isolation Rule (Absolute)

`engine/src/core/` is **pure Rust**. It must compile on any Rust target without browser APIs.

**Allowed in `core/`:**
- `std::*`
- `bevy::*` (pure ECS/math)
- `serde`, `nalgebra`, `noise`, `csgrs`, `bevy_rapier3d/2d`
- Other pure-Rust dependencies

**Forbidden in `core/`:**
- `use web_sys`
- `use js_sys`
- `use wasm_bindgen`
- `extern crate web_sys`
- `#[wasm_bindgen]` attribute

**Only `bridge/` may use browser crates.** Bridge is the only module that knows it's running in a browser.

---

## Command-Driven Design Rule

All engine operations MUST be expressible as JSON commands routed through `handle_command()`.

```
User Action → dispatchCommand(name, payload)
           → WASM handle_command(json_string)
           → commands::dispatch(payload)
           → domain dispatch() match arm
           → pending/<domain>.rs queue function
           → Bevy system drains queue next frame
           → bridge emit event to JS
           → useEngineEvents → Zustand set() → React re-render
```

No engine operation may:
- Directly mutate ECS from JavaScript (bypasses undo/events)
- Reach across the bridge without going through pending queues

---

## Feature Flag Gates

Engine features are gated via Cargo features, not runtime flags:

```toml
[features]
default = []
webgl2 = ["bevy/webgl2"]
webgpu = ["bevy/webgpu", "dep:bevy_hanabi"]
runtime = []  # Strips editor-only systems for game export
```

**`webgpu` gate:** `bevy_hanabi` GPU particle rendering. The data types (`ParticleData`, `ParticleEnabled`) are ALWAYS compiled — only the rendering is gated.

**`runtime` gate:** Applied to system *registrations* in `bridge/mod.rs` via `#[cfg(not(feature = "runtime"))]`, NOT to function definitions. Editor-only systems (gizmos, picking, history) are excluded from the game runtime.

**Never move feature-gated rendering behind UI controls without a working backend.** If controls exist, the backend must work.

---

## Rendering Strategy

- **Primary:** WebGPU (Bevy 0.18, wgpu 27) — auto-detected via `navigator.gpu`
- **Fallback:** WebGL2 — for browsers without WebGPU
- **Two editor binaries** + **two runtime binaries** exist in `web/public/engine-pkg-*/`
- **MUST include `tonemapping_luts` Bevy feature** — without it, materials render pink/magenta

---

## Module Responsibilities

| Module | Responsibility | Allowed imports |
|--------|---------------|-----------------|
| `engine/src/core/` | Pure ECS logic, components, resources, command parsing | core/ siblings, pure Rust crates |
| `engine/src/bridge/` | JS interop, apply systems, event emission | core/ + web_sys/js_sys/wasm_bindgen |
| `engine/src/shaders/` | WGSL shader files | n/a |
| `web/src/stores/` | Zustand state management | web/ only |
| `web/src/hooks/events/` | Engine event → store update | web/ only |
| `web/src/lib/chat/handlers/` | AI tool call → dispatchCommand | web/ only |
| `mcp-server/` | MCP protocol, manifest | mcp-server/ only |

---

## The 8-File Component Checklist

Every new ECS component requires updates to all of these:

1. `engine/src/core/<component>.rs` — Component struct
2. `engine/src/core/pending/<domain>.rs` — Request + queue method + bridge fn
3. `engine/src/core/commands/<domain>.rs` — Dispatch match arm + handler
4. `engine/src/bridge/<domain>.rs` — Apply system + emit
5. `engine/src/bridge/mod.rs` — System registration
6. `engine/src/core/history.rs` — `UndoableAction` variant (if undo-able)
7. `engine/src/core/entity_factory.rs` — `spawn_from_snapshot` arm (if spawnable)
8. `engine/src/core/engine_mode.rs` — `snapshot_scene` query (if serializable)
