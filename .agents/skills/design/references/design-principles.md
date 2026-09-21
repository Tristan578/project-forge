# SpawnForge Design Principles

Every feature design must satisfy all 6 principles. Use these as a checklist during spec review and code review.

---

## Principle 1: Maintain the Sandwich

**The architecture has three layers. Respect their boundaries.**

```
React Shell (Next.js + Zustand + Tailwind)   — Editor UI + AI chat
    |  JSON commands (wasm-bindgen)
Bevy Engine (Rust → WASM)                    — ECS, scene, physics, rendering
    |
Game Runtime (TypeScript Web Workers)        — Exported game logic
```

**Rules:**
- `core/` must be pure Rust — zero browser dependencies, compiles on any target
- `bridge/` is the only module that may import `web_sys`, `js_sys`, or `wasm_bindgen`
- Commands go JS → Rust via `handle_command()` JSON string
- Events go Rust → JS via `emit_event()` callback
- Never mutate ECS directly from JS — that bypasses undo/events/validation
- Audio and scripting execution are JS-side; Rust stores metadata only

**Test question:** Can `engine/src/core/` compile with `cargo build --target x86_64-unknown-linux-gnu`? If no, the sandwich is broken.

---

## Principle 2: Work in Both Render Backends

**Every feature must work in WebGPU (primary) AND WebGL2 (fallback).**

WebGPU is available in modern Chrome and Firefox. WebGL2 covers everything else. Users don't choose — the engine auto-detects at runtime.

**Rules:**
- WebGPU-only capabilities (GPU particles, compute shaders) must degrade gracefully on WebGL2
- Never add a feature that works in WebGPU but crashes on WebGL2
- `bevy_hanabi` GPU particles: data types always compiled, rendering gated behind `#[cfg(feature = "webgpu")]`
- Feature flags: `webgpu` and `webgl2` both produce full editor binaries; `runtime` strips editor systems

**Anti-pattern:** "It works in my Chrome" — test in Firefox (which may use WebGL2 fallback) and ensure no hard crash.

---

## Principle 3: Work in Exported Games

**Features must work in the exported game runtime, not just the editor.**

When a user publishes their game, it runs without the editor UI. The `runtime` Cargo feature strips editor-only systems. Exported games use TypeScript scripting via Web Workers, not Bevy editor logic.

**Rules:**
- Editor-only systems must be gated: `#[cfg(not(feature = "runtime"))]` on the *registration* in `bridge/mod.rs`, not the function definition
- Components used by game logic must be present in the `runtime` build
- Script API (`forge.*`) must expose new capabilities for game scripts to use
- If your feature adds to the `.forge` scene format, the export pipeline must include it

**Test question:** If someone builds a game that depends on this feature and publishes it, does it work?

---

## Principle 4: Maintain AI Parity

**Every action a human can perform must be expressible as a JSON command.**

SpawnForge's core promise is "describe what you want, and the AI builds it." This only works if the AI's vocabulary (MCP commands) matches human capabilities (UI actions) exactly.

**Rules:**
- Every new UI action needs a corresponding MCP command in both manifest files
- Every MCP command needs a chat handler that validates args and dispatches correctly
- Chat handlers must return structured `{ success, message }` with enough detail for the AI to self-correct on failure
- Query commands must return structured data the AI can reason about for follow-up decisions

**Test question:** Can an AI session, with zero mouse clicks, fully exercise this feature through MCP commands alone?

**Validation:**
```bash
bash .claude/tools/validate-mcp.sh audit
```

---

## Principle 5: Scale with Entity Count

**No O(n²) or unbounded growth in scenes with thousands of entities.**

SpawnForge users will build RPG worlds with 10,000+ entities. Performance must not degrade catastrophically with entity count.

**Rules:**
- Per-frame systems should be O(n) in entity count (Bevy query iteration is O(n))
- Undo history grows linearly — consider how much data each new `UndoableAction` stores
- Scene serialization (`.forge` format) — how does your feature's data grow with entity count?
- Network calls, JS allocations, and React re-renders in response to entity changes must be bounded
- Use virtual scrolling in UI lists > 50 items
- Never render all entities' data simultaneously in the inspector — only the selected entity

**Test question:** With 1000 entities, does frame time degrade? With 10000 entities?

---

## Principle 6: Support Undo

**Every user-visible state change must be undoable.**

Game development is an iterative process. Users explore, make mistakes, and need to backtrack. An action that can't be undone is a trap.

**Rules:**
- Every command that changes scene state needs a corresponding `UndoableAction` variant in `history.rs`
- Snapshots capture before/after state using `EntitySnapshot`
- Entity IDs are preserved across undo/redo (entities are not re-spawned with new IDs)
- Multi-entity operations use `Multi*Change` variants (e.g., `MultiTransformChange`)
- "Apply" operations (CSG booleans, mesh combines) are especially important to make undoable

**Current variants (29):** TransformChange, MultiTransformChange, Rename, Spawn, Delete, Duplicate, VisibilityChange, MaterialChange, LightChange, PhysicsChange, ScriptChange, AudioChange, ReverbZoneChange, ParticleChange, ShaderChange, CsgOperation, TerrainChange, ExtrudeShape, LatheShape, ArrayEntity, CombineMeshes, JointChange, GameComponentChange, AnimationClipChange, SpriteChange, Physics2dChange, Joint2dChange, TilemapChange, SkeletonChange

**Test question:** After using this feature, does Ctrl+Z restore the previous state exactly?

---

## Applying the Principles in Design Reviews

When reviewing a spec or PR, ask:

1. **Sandwich**: Does it add browser imports to `core/`? Does it bypass the command pipeline?
2. **Two backends**: Will this work when the user is on WebGL2? Has it been tested there?
3. **Exported games**: Is the `runtime` feature gating correct? Does the export pipeline include this?
4. **AI parity**: Is there an MCP command? A chat handler? A manifest entry in both files?
5. **Scale**: Is there any O(n²) path? Does undo history grow reasonably?
6. **Undo**: Is there an `UndoableAction` variant? Are entity IDs stable across undo?

All 6 must be answered "yes" before a feature ships.
