# New ECS Component Checklist

Use this template when adding any new ECS component to SpawnForge. Copy and fill in the blanks, then check off each item as you complete it.

---

## Component: `<ComponentName>`

**Domain**: (transform / material / physics / audio / animation / particles / scripting / game / sprite / scene / other)
**Ticket**: PF-XXXX
**Is user-visible state change?**: yes / no (determines if undo/redo is needed)
**Spawnable from snapshot?**: yes / no (determines if entity_factory needs updating)

---

## Rust Engine (Core — 4 required files)

- [ ] **`engine/src/core/<component>.rs`**
  - [ ] Component struct defined with `#[derive(Component, Clone, Debug, Serialize, Deserialize)]`
  - [ ] `Default` impl provided
  - [ ] `pub mod <component>;` added to `engine/src/core/mod.rs`

- [ ] **`engine/src/core/pending/<domain>.rs`**
  - [ ] Request struct defined
  - [ ] `thread_local!` queue variable added
  - [ ] `queue_<component>_update()` function added (called from commands layer)
  - [ ] `drain_<component>_queue()` function added (called from bridge layer)

- [ ] **`engine/src/core/commands/<domain>.rs`**
  - [ ] Match arm added in domain `dispatch()` function
  - [ ] Handler function `handle_<command_name>()` implemented
  - [ ] Required fields validated with `.ok_or("Missing ...")`
  - [ ] Optional fields have sensible defaults

- [ ] **`engine/src/bridge/<domain>.rs`**
  - [ ] Apply system `apply_<component>_updates()` implemented
  - [ ] System registered in `bridge/mod.rs` `SelectionPlugin::build()`
  - [ ] Appropriate `SystemSet` used (`EditorSystemSet` or `PlaySystemSet`)
  - [ ] Emits event after update (so Zustand store refreshes)

## Rust Engine (Supporting — add if needed)

- [ ] **`engine/src/core/history.rs`** (if user-visible state change)
  - [ ] `UndoableAction` variant added: `<ComponentName>Change { before: EntitySnapshot, after: EntitySnapshot }`
  - [ ] Variant handled in `apply_undo()` and `apply_redo()`

- [ ] **`engine/src/core/entity_factory.rs`** (if spawnable from snapshot)
  - [ ] `spawn_from_snapshot` match arm added
  - [ ] `delete_entity` handles cleanup
  - [ ] `duplicate_entity` copies the component

- [ ] **`engine/src/core/engine_mode.rs`** (if component should be serialized in scene)
  - [ ] `snapshot_scene` query includes the new component

- [ ] **`engine/src/bridge/events.rs`** (if emitting events)
  - [ ] `emit_<component>_changed()` function added

- [ ] **`engine/src/bridge/query.rs`** (if component has query support)
  - [ ] Query handler added

## Web Layer (4 required files)

- [ ] **`web/src/stores/slices/<domain>Slice.ts`**
  - [ ] Interface for the slice state defined
  - [ ] State field (`<component>Map: Record<string, Data>`) added
  - [ ] `set<ComponentName>Data()` action implemented
  - [ ] `clear<ComponentName>Data()` action implemented
  - [ ] Slice re-exported from `slices/index.ts`
  - [ ] Slice composed into `editorStore.ts`

- [ ] **`web/src/hooks/events/<domain>Events.ts`**
  - [ ] Event handler for `<COMPONENT>_CHANGED` engine event implemented
  - [ ] Handler registered in `useEngineEvents.ts`

- [ ] **`web/src/lib/chat/handlers/<domain>Handlers.ts`**
  - [ ] Handler for each MCP command implemented
  - [ ] `parseArgs()` validates all required args
  - [ ] Returns `{ success: true, message: '...' }` with enough detail for AI
  - [ ] Registered in `executor.ts` handler registry

- [ ] **`web/src/components/editor/<Component>Inspector.tsx`**
  - [ ] Inspector panel component created
  - [ ] Uses `useEditorStore` selector (granular — don't select entire store)
  - [ ] All fields have labels and tooltips
  - [ ] Inputs are debounced (100ms sliders, 300ms text)
  - [ ] Handles null/undefined entity data gracefully

## Integration (5 required files)

- [ ] **`web/src/components/editor/InspectorPanel.tsx`**
  - [ ] Import added
  - [ ] Rendered when entity has this component
  - [ ] No panelRegistry nesting bug (read 10 lines before AND after insertion point!)

- [ ] **`web/src/components/chat/ToolCallCard.tsx`**
  - [ ] Display label added for each new command

- [ ] **`mcp-server/manifest/commands.json`**
  - [ ] Entry added for each command
  - [ ] `visibility` field set (`'public'` or `'internal'`)
  - [ ] Description is specific (ranges, units, side effects — not just the name)
  - [ ] All parameters documented

- [ ] **`web/src/data/commands.json`**
  - [ ] IDENTICAL copy of manifest entries (sync with mcp-server/manifest/commands.json)

- [ ] **`TESTING.md`**
  - [ ] Manual test cases added

## Tests (required)

- [ ] `web/src/stores/slices/__tests__/<domain>Slice.test.ts` — store slice unit tests
- [ ] `web/src/hooks/events/__tests__/<domain>Events.test.ts` — event handler tests
- [ ] `web/src/lib/chat/handlers/__tests__/<domain>Handlers.test.ts` — arg validation + dispatch tests

## Final Validation

```bash
# Architecture boundaries (bridge isolation)
bash .claude/tools/validate-rust.sh check

# MCP manifest sync + tests
bash .claude/tools/validate-mcp.sh full

# Frontend lint + tsc + tests
bash .claude/tools/validate-frontend.sh quick

# Full project
bash .claude/tools/validate-all.sh
```

All must pass with zero violations before declaring the component done.

---

## Notes

- **panelRegistry bug**: The #1 agent bug (21+ instances). Always read 10 lines before AND after the insertion point in InspectorPanel.tsx. New panels get nested inside the preceding entry's object literal if the closing `},` is swallowed.
- **ECS query limits**: Max 15 components per query tuple. If you hit this, split into separate `Query<>` params.
- **System param limits**: Max 16 system params. Merge related queries if you hit this.
- **`visibility` is mandatory**: Every manifest command needs `visibility: 'public'` or `'internal'`. Manifest tests will fail without it.
