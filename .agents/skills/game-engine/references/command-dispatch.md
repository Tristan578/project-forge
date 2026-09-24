# Command Dispatch System

Every engine capability is a JSON command through `handle_command()`. This document explains how the dispatch pipeline works and how to add new commands.

## The Full Chain

```
1. JS Action (UI click, AI chat, MCP call)
       |
       v
2. TypeScript: dispatchCommand('my_command', { entityId: 'abc', value: 42 })
       |
       v
3. WASM bridge: handle_command('{"type":"my_command","entityId":"abc","value":42}')
       |
       v
4. Rust: engine/src/core/commands/mod.rs dispatch()
         → parse JSON, route to domain dispatch()
       |
       v
5. Rust: engine/src/core/commands/<domain>.rs dispatch()
         → match arm for "my_command"
         → call handle_my_command(payload)
       |
       v
6. Rust: core/pending/<domain>.rs
         → queue_my_command_from_bridge(Request { ... })
         → push to thread-local Vec
       |
       v
7. [NEXT BEVY FRAME — up to 16ms latency]
       |
       v
8. Rust: engine/src/bridge/<domain>.rs
         → apply_my_command_updates() Bevy system runs
         → drain_my_command_queue()
         → update ECS components via Commands
       |
       v
9. Rust: engine/src/bridge/events.rs
         → emit_my_command_applied("abc", 42)
         → JS callback fires
       |
       v
10. JS: useEngineEvents → domain handler → Zustand set() → React re-render
```

## Why This Pattern?

- **Thread safety**: Bevy ECS must be mutated from within a Bevy system. We can't call ECS APIs from the JS event loop thread. The pending queue is the synchronization point.
- **Undo/Redo**: The bridge apply system records before/after snapshots for `UndoableAction`.
- **AI Parity**: Every capability accessible through this same channel — no separate "AI path" or "UI path".
- **Testability**: Command serialization can be round-trip tested without spinning up the full engine.

## Adding a New Command

### 1. Define the handler (core/commands/<domain>.rs)

```rust
// In the domain's dispatch() function:
"my_new_command" => handle_my_new_command(payload),

fn handle_my_new_command(payload: serde_json::Value) -> super::CommandResult {
    // Validate required fields
    let entity_id = payload.get("entityId")
        .and_then(|v| v.as_str())
        .ok_or("Missing required field: entityId")?
        .to_string();

    // Parse optional fields with defaults
    let intensity = payload.get("intensity")
        .and_then(|v| v.as_f64())
        .unwrap_or(1.0) as f32;

    // Enqueue — returns false if engine not initialized
    if crate::core::pending::my_domain::queue_my_new_command(
        MyNewCommandRequest { entity_id, intensity }
    ) {
        Ok(())
    } else {
        Err("Engine not initialized — PendingCommands resource unavailable".to_string())
    }
}
```

### 2. Add the MCP manifest entry (BOTH locations)

`mcp-server/manifest/commands.json` AND `web/src/data/commands.json` (keep in sync):

```json
{
  "name": "my_new_command",
  "category": "my_domain",
  "description": "What this does, what params affect, valid ranges.",
  "visibility": "public",
  "parameters": [
    {
      "name": "entityId",
      "type": "string",
      "required": true,
      "description": "ID of the target entity"
    },
    {
      "name": "intensity",
      "type": "number",
      "required": false,
      "default": 1.0,
      "description": "Effect intensity (0.0–1.0)"
    }
  ]
}
```

### 3. Add the chat handler (web/src/lib/chat/handlers/<domain>Handlers.ts)

```typescript
my_new_command: async (args, { dispatchCommand }) => {
  const parsed = parseArgs(args, {
    entityId: { type: 'string', required: true },
    intensity: { type: 'number', required: false, default: 1.0 },
  });
  if (!parsed.success) return parsed;

  dispatchCommand('my_new_command', parsed.data);
  return {
    success: true,
    message: `Applied my_new_command to ${parsed.data.entityId} at intensity ${parsed.data.intensity}`,
  };
},
```

### 4. Add to ToolCallCard (web/src/components/chat/ToolCallCard.tsx)

```typescript
case 'my_new_command': return 'Applying My Effect';
```

## Command Naming Conventions

| Pattern | Example | Notes |
|---------|---------|-------|
| `set_<component>` | `set_material` | Sets component data on an entity |
| `add_<component>` | `add_physics` | Adds a new component to an entity |
| `remove_<component>` | `remove_physics` | Removes a component from an entity |
| `update_<component>` | `update_terrain` | Partial update to existing component |
| `spawn_<type>` | `spawn_cube` | Creates a new entity |
| `delete_entity` | — | Removes an entity |
| `query_<thing>` | `query_entity` | Returns data without side effects |
| `apply_<action>` | `apply_csg_union` | Performs a transformation |

## Error Handling

Commands return `CommandResult` which is `Result<(), String>`. Errors surface to JS as:
```typescript
{ success: false, error: "Missing required field: entityId" }
```

The chat handler receives this and can tell the AI what went wrong so it can retry with corrected arguments.

## Query Commands

Some commands return data instead of mutating state. These use a different path:

```
JS: queryEntity(entityId) → handle_command('{"type":"query_entity","entityId":"abc"}')
  → commands::query::dispatch() → serialize ECS component data to JSON
  → CommandResult with JSON payload
  → JS receives { success: true, data: { ... entity snapshot ... } }
```

Query commands in `core/commands/` call `bridge/query.rs` helper functions to serialize component data.

## Validation Tools

After adding a new command:
```bash
# Verify manifests are in sync
bash .claude/tools/validate-mcp.sh sync

# Verify AI parity (every command has a handler)
bash .claude/tools/validate-mcp.sh audit

# Run MCP server tests
bash .claude/tools/validate-mcp.sh test
```
