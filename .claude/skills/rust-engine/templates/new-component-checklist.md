# New ECS Component Checklist

When adding ANY new ECS component, you MUST update all of these files. No shortcuts.

## Rust Engine (4 required files)

### 1. Component Definition
**File:** `engine/src/core/<component>.rs`
- Add `pub mod <component>;` to `engine/src/core/mod.rs`
- Component struct with derives: `Component`, `Clone`, `Debug`, `Serialize`, `Deserialize`

### 2. Pending Queue
**File:** `engine/src/core/pending/<domain>.rs`
- Request struct (e.g., `SetMyComponentRequest { entity_id: String, ... }`)
- Queue method on `PendingCommands` (e.g., `my_component_requests: Vec<SetMyComponentRequest>`)
- Bridge function (e.g., `pub fn queue_set_my_component_from_bridge(req: SetMyComponentRequest) -> bool`)

### 3. Command Dispatch
**File:** `engine/src/core/commands/<domain>.rs`
- Add match arm in domain's `dispatch()` function
- Handler: parse JSON payload, call queue function, return `Ok(())` or `Err(String)`

### 4. Bridge Apply System
**File:** `engine/src/bridge/<domain>.rs`
- Apply system: drain pending queue, insert/update ECS components
- Selection emit: when component changes, emit `SelectionChangedEvent` with updated data
- Register in `engine/src/bridge/mod.rs` → `SelectionPlugin::build()`

## Rust Engine (conditional files — update if applicable)

### 5. History (if undo-able)
**File:** `engine/src/core/history.rs`
- Add `UndoableAction` variant (currently 29 variants)
- Store before/after `EntitySnapshot` for the affected fields

### 6. Entity Factory (if spawnable/deletable)
**File:** `engine/src/core/entity_factory.rs`
- `spawn_from_snapshot`: add arm to match for new component data
- `delete`/`duplicate`: ensure component is captured in snapshot

### 7. Scene Export (if serializable)
**File:** `engine/src/core/engine_mode.rs`
- `snapshot_scene`: add query parameter for new component
- Populate `EntitySnapshot` field from ECS query

### 8. Events / Query
**Files:** `engine/src/bridge/events.rs`, `engine/src/bridge/query.rs`
- Emit function for component changes
- Query handler if component supports query requests

## Web Layer (4 required files)

### 9. Store Slice
**File:** `web/src/stores/slices/<domain>Slice.ts`
- State field + action for the component
- Re-export from `web/src/stores/slices/index.ts`

### 10. Event Handler
**File:** `web/src/hooks/events/<domain>Events.ts`
- Handle engine events for the component → update Zustand store

### 11. Chat Handler
**File:** `web/src/lib/chat/handlers/<domain>Handlers.ts`
- Tool call handler for MCP parity
- Register in `web/src/lib/chat/executor.ts`

### 12. Inspector UI
**File:** `web/src/components/editor/<Component>Inspector.tsx`
- Import and render in `web/src/components/editor/InspectorPanel.tsx`

## Integration (3 required files)

### 13. Tool Call Display
**File:** `web/src/components/chat/ToolCallCard.tsx`
- Human-readable label for the command

### 14. MCP Manifest (BOTH locations)
**Files:** @mcp-server/manifest/commands.json AND @web/src/data/commands.json
- Must be IDENTICAL copies. Add command entries for the new component.

### 15. Manual Test Cases
**File:** @TESTING.md
- Add test cases for the new user-facing feature

## EntitySnapshot Rules

- Use `EntitySnapshot::new(entity_id, entity_type, name, transform)` — defaults ~35 optional fields to None
- In bridge modules it's imported as `HistEntitySnapshot` — same type
- When adding `Option<T>` field: update struct + `new()` constructor + `spawn_from_snapshot`
