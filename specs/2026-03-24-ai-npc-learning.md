# Spec: AI NPCs with Learning Behavior

> **Status:** DRAFT
> **Date:** 2026-03-24
> **Ticket:** PF-580
> **Scope:** NPCs that learn from player interactions and evolve behavior over time

## Problem

Static NPC behavior makes games feel repetitive. SpawnForge already has a behavior tree system (`web/src/lib/ai/behaviorTree.ts`) and 12 game component types, but NPC behavior is fully deterministic. Players want NPCs that remember past interactions, adapt strategies, and create emergent gameplay -- the kind of dynamic AI that makes games feel alive.

## Solution

### Architecture Overview

Layer a **learning memory system** on top of the existing behavior tree infrastructure. NPCs store interaction logs in a per-entity memory, and an AI model periodically re-evaluates behavior tree weights based on accumulated experience. All learning state lives in JS (script worker) -- Rust stores only the `NpcMemoryData` ECS component for serialization.

```
Player Action → forge.npc.recordInteraction() → NPC Memory (JS)
                                                      ↓
                            AI Model (periodic) → Updated BT weights
                                                      ↓
                            Behavior Tree tick → Different NPC decisions
```

### Phase 1: NPC Memory + Interaction Logging

1. **NpcMemory** data structure stored per-entity in the script worker.
   - File: `web/src/lib/ai/npcMemory.ts`
   - Stores: `InteractionLog[]` (player action, NPC response, outcome, timestamp).
   - Capped at 100 interactions per NPC (ring buffer) to bound memory.
   - Serializable to JSON for scene save/load.

2. **Rust ECS component** `NpcMemoryData` for persistence.
   - File: `engine/src/core/npc.rs` -- component struct with serialized JSON blob.
   - Pending queue: `engine/src/core/pending/game.rs` -- `NpcMemoryUpdateRequest`.
   - Bridge: emitted on selection for inspector display.

3. **forge.npc namespace** in script API.
   - File: `web/src/lib/scripting/forgeTypes.ts` -- add `forge.npc.*` declarations.
   - Methods: `recordInteraction(entityId, action, outcome)`, `getMemory(entityId)`, `getRelationship(entityId, targetId)`.

4. **MCP commands**: `set_npc_memory`, `get_npc_memory`, `clear_npc_memory`.

### Phase 2: AI Behavior Adaptation

5. **BehaviorAdapter** takes NPC memory + current behavior tree, asks AI to suggest weight adjustments.
   - File: `web/src/lib/ai/behaviorAdapter.ts`
   - Runs on configurable interval (default: every 30 interactions or 60s).
   - AI prompt includes: NPC personality, recent interactions, current BT structure.
   - Output: modified `BehaviorNode.params` weights (e.g., aggression, caution, friendliness).
   - Uses existing AI provider chain (`web/src/lib/ai/models.ts`).

6. **Relationship system**: NPCs track sentiment toward player and other NPCs.
   - `InteractionOutcome` affects a -1.0 to 1.0 relationship score.
   - Relationship influences behavior tree selector priorities.

### Phase 3: Emergent Group Behavior

7. NPCs share memories (gossip system) -- nearby NPCs exchange interaction summaries.
8. Faction-level reputation derived from individual NPC relationships.
9. NPC dialogue adapts based on memory (integrates with `dialogueHandlers.ts`).

### Rust Changes (Phase 1)

| File | Change |
|------|--------|
| `engine/src/core/npc.rs` | New: `NpcMemoryData` component |
| `engine/src/core/pending/game.rs` | Add `NpcMemoryUpdateRequest` |
| `engine/src/core/commands/game.rs` | Add `set_npc_memory`, `get_npc_memory` dispatch |
| `engine/src/bridge/game.rs` | Add `apply_npc_memory_updates`, emit on selection |
| `engine/src/core/history.rs` | Add `NpcMemoryChange` to `UndoableAction` |
| `engine/src/core/entity_factory.rs` | Add `npc_memory_data` to `EntitySnapshot` |

### Web Changes (Phase 1)

| File | Change |
|------|--------|
| `web/src/lib/ai/npcMemory.ts` | New: NpcMemory class with ring buffer |
| `web/src/lib/scripting/forgeTypes.ts` | Add `forge.npc.*` namespace |
| `web/src/lib/chat/handlers/gameplayHandlers.ts` | Add NPC memory MCP handlers |
| `web/src/stores/slices/gameSlice.ts` | Add NPC memory inspector state |
| `web/src/components/editor/NpcMemoryInspector.tsx` | New: memory viewer panel |

## Constraints

- **Memory per NPC**: 100 interactions max (ring buffer). ~10KB serialized per NPC.
- **AI calls**: Behavior adaptation is async and non-blocking. Max 1 call per NPC per 60s.
- **No Rust AI deps**: All AI inference stays in JS. Rust only stores serialized blobs.
- **Scene save**: NPC memory serializes into `.forge` file via `NpcMemoryData` component.
- **Runtime feature**: NPC memory works in exported games (script worker handles it).

## Acceptance Criteria

- Given an NPC with a behavior tree, When the player attacks it 5 times, Then its memory contains 5 attack interactions and relationship score decreases.
- Given accumulated NPC memory, When the behavior adapter runs, Then the behavior tree weights shift (e.g., increased flee priority after repeated attacks).
- Given an NPC with negative relationship, When the player approaches, Then the NPC selects defensive/flee behavior over friendly behavior.
- Given a scene with NPC memory, When saved and reloaded, Then NPC memory and relationship scores persist.

## Phase 1 Subtasks

1. Create `NpcMemory` class with ring buffer and serialization in `npcMemory.ts`
2. Add `NpcMemoryData` ECS component in `engine/src/core/npc.rs`
3. Add pending queue + command dispatch for NPC memory CRUD
4. Add `forge.npc.*` namespace to `forgeTypes.ts` and wire in script worker
5. Create `NpcMemoryInspector.tsx` for viewing interaction logs in editor
6. Add MCP handlers: `set_npc_memory`, `get_npc_memory`, `clear_npc_memory`
7. Add unit tests for NpcMemory ring buffer, serialization, relationship scoring
