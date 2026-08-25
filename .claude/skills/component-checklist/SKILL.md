---
name: component-checklist
description: "Use when adding a new ECS component, MCP command, or engine capability. Checklist of all files that must be updated across Rust engine, web layer, and integration points."
---

# New Component / Command Checklist

When adding a **new ECS component**, update these domain-scoped files:

## Rust Engine (4 required files)
1. `engine/src/core/<component>.rs` — Component struct + marker (add `pub mod` in `core/mod.rs`)
2. `engine/src/core/pending/<domain>.rs` — Request structs + queue methods + bridge fns
3. `engine/src/core/commands/<domain>.rs` — Dispatch entry + handler function
4. `engine/src/bridge/<domain>.rs` — Apply system + selection emit (register in `bridge/mod.rs` SelectionPlugin::build())

## Rust Engine (supporting, if needed)
5. `engine/src/core/history.rs` — `UndoableAction` variant + `EntitySnapshot` field
6. `engine/src/core/entity_factory.rs` — delete/duplicate/undo/redo + `spawn_from_snapshot`
7. `engine/src/core/engine_mode.rs` — `snapshot_scene` (separate query param)
8. `engine/src/bridge/events.rs` — Emit function(s)
9. `engine/src/bridge/query.rs` — Query handler (if component has query support)

## Web Layer (4 required files)
10. `web/src/stores/slices/<domain>Slice.ts` — State + actions (+ re-export from `slices/index.ts`)
11. `web/src/hooks/events/<domain>Events.ts` — Event handler(s)
12. `web/src/lib/chat/handlers/<domain>Handlers.ts` — Tool call handler(s) (registered in `executor.ts` handler registry)
13. `web/src/components/editor/<Inspector>.tsx` — Inspector panel

## Integration (5 required files)
14. `web/src/components/editor/InspectorPanel.tsx` — Import + render
15. `web/src/components/chat/ToolCallCard.tsx` — Display labels
16. `mcp-server/manifest/commands.json` — MCP commands. Set `visibility: 'public'` or `'internal'` (mandatory)
17. `web/src/data/commands.json` — **COPY of #16** (keep in sync)
18. `TESTING.md` — Manual test cases

## Game Components (a much shorter list — do NOT run the 18 above)

A **game component** (health, damage, characterController, …) is a variant of one
existing enum, not a new ECS component. Adding a 14th type touches six places:

1. `engine/src/core/game_components.rs` — `GameComponentData` variant + its data struct
   (the enum is `#[serde(tag = "type", rename_all = "camelCase")]`, so the variant name
   IS the wire tag)
2. `engine/src/core/game_components.rs` — the `build_game_component` match arm, using
   `prop_f32` / `prop_u32` for every numeric field so the engine clamps it
3. `web/src/stores/slices/types.ts` — the member of the `GameComponentData` union
4. `web/src/lib/engine/gameComponentWire.ts` — `ENGINE_TYPE_BY_STORE_TYPE` (the
   snake_case command name ↔ camelCase serde tag pair) and, for every numeric field,
   an entry in `F32_RANGES` / `U32_MAXES` mirroring the Rust bounds
5. `web/src/lib/engine/__tests__/gameComponentWire.test.ts` — the tables there are
   pinned against the Rust by a textual scan with a COUNT assertion, so a new
   `prop_f32` / `prop_u32` call site FAILS the suite until it is mirrored. The prose
   counts in the coercer doc comments are pinned too — update the sentence, not just
   the table
6. `web/src/components/editor/GameComponentInspector.tsx` — the editing UI

Everything between the store and the engine — both directions — goes through
`gameComponentWire.ts`. Never hand-build a component payload and never cast an
emitted one: see `rules/gotchas-engine.md` → "`dispatchCommand` returns `void`".
