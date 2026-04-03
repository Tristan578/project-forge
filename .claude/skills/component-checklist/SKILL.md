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
