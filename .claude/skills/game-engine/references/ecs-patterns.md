# SpawnForge ECS Patterns Quick Reference

## Architecture Overview

SpawnForge uses Bevy 0.18 ECS running as WASM in the browser. All engine state is ECS components. No global mutable state. No direct DOM access from Rust.

```
engine/src/
├── core/          # Pure Rust — NO web_sys/js_sys/wasm_bindgen
│   ├── commands/  # JSON command dispatch → pending queue
│   ├── pending/   # Thread-local request queues (one per domain)
│   └── *.rs       # ECS components, resources, system logic
└── bridge/        # ONLY module allowed web_sys/js_sys/wasm_bindgen
    └── *.rs       # Apply systems (drain pending), emit events to JS
```

## Adding a New Component — 4-File Rust Checklist

### Step 1: `engine/src/core/<component>.rs`

```rust
use bevy::prelude::*;
use serde::{Deserialize, Serialize};

/// The component itself
#[derive(Component, Clone, Debug, Serialize, Deserialize)]
pub struct MyComponent {
    pub value: f32,
    pub enabled: bool,
}

impl Default for MyComponent {
    fn default() -> Self {
        Self { value: 1.0, enabled: true }
    }
}
```

Then add `pub mod my_component;` in `engine/src/core/mod.rs`.

### Step 2: `engine/src/core/pending/<domain>.rs`

```rust
use std::cell::RefCell;

/// Request struct — what JS sends
#[derive(Clone, Debug)]
pub struct MyComponentRequest {
    pub entity_id: String,
    pub value: f32,
    pub enabled: bool,
}

thread_local! {
    static MY_COMPONENT_QUEUE: RefCell<Vec<MyComponentRequest>> = RefCell::new(Vec::new());
}

/// Called by the command handler (core/) — no browser deps
pub fn queue_my_component_update(req: MyComponentRequest) -> bool {
    MY_COMPONENT_QUEUE.with(|q| {
        q.borrow_mut().push(req);
        true
    })
}

/// Called by the bridge apply system
pub fn drain_my_component_queue() -> Vec<MyComponentRequest> {
    MY_COMPONENT_QUEUE.with(|q| q.borrow_mut().drain(..).collect())
}
```

### Step 3: `engine/src/core/commands/<domain>.rs`

```rust
/// Dispatch match arm in the domain dispatch() function
"set_my_component" => handle_set_my_component(payload),

fn handle_set_my_component(payload: serde_json::Value) -> super::CommandResult {
    let entity_id = payload.get("entityId")
        .and_then(|v| v.as_str())
        .ok_or("Missing entityId")?
        .to_string();
    let value = payload.get("value")
        .and_then(|v| v.as_f64())
        .unwrap_or(1.0) as f32;
    let enabled = payload.get("enabled")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);

    if crate::core::pending::my_domain::queue_my_component_update(
        MyComponentRequest { entity_id, value, enabled }
    ) {
        Ok(())
    } else {
        Err("PendingCommands not initialized".to_string())
    }
}
```

### Step 4: `engine/src/bridge/<domain>.rs`

```rust
use bevy::prelude::*;
use crate::core::entity_id::EntityId;
use crate::core::my_component::MyComponent;
use crate::core::pending::my_domain::{drain_my_component_queue, MyComponentRequest};

/// Apply system — drains the pending queue and updates ECS components
pub fn apply_my_component_updates(
    mut commands: Commands,
    entity_query: Query<(Entity, &EntityId, Option<&MyComponent>)>,
) {
    let requests = drain_my_component_queue();
    if requests.is_empty() { return; }

    for req in requests {
        if let Some((entity, _, _)) = entity_query.iter()
            .find(|(_, id, _)| id.0 == req.entity_id)
        {
            commands.entity(entity).insert(MyComponent {
                value: req.value,
                enabled: req.enabled,
            });
            // Emit event back to JS so the store updates
            crate::bridge::events::emit_my_component_changed(&req.entity_id, req.value, req.enabled);
        }
    }
}
```

Register in `bridge/mod.rs` `SelectionPlugin::build()`:
```rust
.add_systems(Update, apply_my_component_updates.in_set(EditorSystemSet))
```

## Adding a New Component — 4-File Web Checklist

### Step 5: `web/src/stores/slices/<domain>Slice.ts`

```typescript
export interface MyComponentSlice {
  myComponentMap: Record<string, MyComponentData>;
  setMyComponentData: (entityId: string, data: MyComponentData) => void;
  clearMyComponentData: (entityId: string) => void;
}

export const createMyComponentSlice: StateCreator<EditorStore, [], [], MyComponentSlice> = (set) => ({
  myComponentMap: {},
  setMyComponentData: (entityId, data) =>
    set(state => ({ myComponentMap: { ...state.myComponentMap, [entityId]: data } })),
  clearMyComponentData: (entityId) =>
    set(state => {
      const { [entityId]: _, ...rest } = state.myComponentMap;
      return { myComponentMap: rest };
    }),
});
```

Re-export from `slices/index.ts`.

### Step 6: `web/src/hooks/events/<domain>Events.ts`

```typescript
export function handleMyComponentEvent(
  event: EngineEvent,
  store: EditorStore,
): void {
  if (event.type === 'MY_COMPONENT_CHANGED') {
    store.setMyComponentData(event.entityId, {
      value: event.value,
      enabled: event.enabled,
    });
  }
}
```

Register in `useEngineEvents.ts`.

### Step 7: `web/src/lib/chat/handlers/<domain>Handlers.ts`

```typescript
export const handlers: Record<string, ToolHandler> = {
  set_my_component: async (args, { dispatchCommand }) => {
    const parsed = parseArgs(args, {
      entityId: { type: 'string', required: true },
      value: { type: 'number', required: false, default: 1.0 },
      enabled: { type: 'boolean', required: false, default: true },
    });
    if (!parsed.success) return parsed;

    dispatchCommand('set_my_component', parsed.data);
    return { success: true, message: `Updated my component on ${parsed.data.entityId}` };
  },
};
```

### Step 8: `web/src/components/editor/<MyInspector>.tsx`

```tsx
export function MyInspector({ entityId }: { entityId: string }) {
  const data = useEditorStore(s => s.myComponentMap[entityId]);
  const dispatch = useEditorStore(s => s.dispatchCommand);

  if (!data) return null;

  return (
    <div className="space-y-3 p-3">
      <h3 className="text-xs font-semibold uppercase text-zinc-400">My Component</h3>
      {/* Inspector fields */}
    </div>
  );
}
```

## Entity Lifecycle

```
Spawn:   pending queue → apply_spawn_requests() → entity.insert(components) → emit_entity_spawned()
Select:  SelectionChangedEvent → emit_selection_changed() → JS → store.setSelection()
Delete:  pending queue → apply_delete_requests() → entity.despawn() → emit_entity_deleted()
Undo:    history.pop() → spawn_from_snapshot(snap) → entity re-created at snap state
```

## Command Dispatch Chain (Full Path)

```
JS: dispatchCommand('set_material', { entityId, color })
  → web/src/stores: store action
  → WASM: handle_command('{"type":"set_material","entityId":"...","color":"..."}')
  → engine/src/core/commands/material.rs: dispatch() match arm
  → queue_material_update_from_bridge(MaterialRequest { ... })
  → engine/src/core/pending/material.rs: thread-local push
  → [next Bevy frame]
  → engine/src/bridge/material.rs: apply_material_updates() system
  → drain_material_queue() → ECS component update
  → engine/src/bridge/events.rs: emit_material_changed()
  → JS callback → useEngineEvents → materialEvents handler
  → Zustand set() → React re-render
```

## Event Emission (Rust → JS)

```rust
// engine/src/bridge/events.rs
pub fn emit_my_component_changed(entity_id: &str, value: f32, enabled: bool) {
    emit_event(&serde_json::json!({
        "type": "MY_COMPONENT_CHANGED",
        "entityId": entity_id,
        "value": value,
        "enabled": enabled,
    }));
}
```

## Supporting Files for Undo/Redo

When the component is user-facing and state changes should be undoable:

- `engine/src/core/history.rs` — Add `UndoableAction::MyComponentChange { before: EntitySnapshot, after: EntitySnapshot }`
- `engine/src/core/entity_factory.rs` — Add arm in `spawn_from_snapshot` if component carries data needed to recreate the entity
- `engine/src/core/engine_mode.rs` — Add field to `snapshot_scene` query if component should be saved in scene snapshots

## ECS System Limits (Bevy 0.18)

| Limit | Value | Workaround |
|-------|-------|-----------|
| Query tuple params | 15 | Split into separate `Query<>` params |
| System params total | 16 | Merge related queries |
| `add_systems` tuple | ~20 | Split into multiple `add_systems` calls |
| Query conflict (B0001) | `&T` + `&mut T` | Use `ParamSet<(Query<...>, Query<...>)>` |
| Resource conflict (B0002) | `Res<T>` + `ResMut<T>` | Use only `ResMut<T>` |

## Feature Gating

```rust
// WebGPU-only code (GPU particles, etc.)
#[cfg(feature = "webgpu")]
pub fn register_gpu_systems(app: &mut App) { ... }

// Editor-only systems (stripped for exported games)
// Gate the REGISTRATION, not the function definition:
#[cfg(not(feature = "runtime"))]
app.add_systems(Update, my_editor_only_system);
```
