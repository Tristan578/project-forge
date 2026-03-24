# Spec: Live Narrative AI

> **Status:** DRAFT
> **Date:** 2026-03-24
> **Ticket:** PF-582
> **Scope:** Story that responds to player actions in real-time

## Problem

SpawnForge has a dialogue tree editor (`DialogueTreeEditor.tsx`) and quest generator (`questGenerator.ts`) that produce static narrative structures. Once authored, the story does not change based on player behavior. Modern players expect stories that react to their choices, with consequences that ripple through the game world. Building branching narratives manually is exponentially complex -- AI can generate and manage this dynamism at runtime.

## Existing Infrastructure

- `web/src/lib/ai/questGenerator.ts` -- Procedural quest chains with 10 quest types, objectives, rewards.
- `web/src/stores/dialogueStore.ts` -- Dialogue tree state with nodes (text, choice, condition, action).
- `web/src/lib/chat/handlers/dialogueHandlers.ts` -- MCP handlers for dialogue CRUD.
- `web/src/lib/ai/behaviorTree.ts` -- Behavior tree DSL for NPC logic.
- `forge.scene.*`, `forge.npc.*` (proposed in PF-580) -- Script API for runtime queries.

## Solution

### Architecture Overview

A **NarrativeDirector** service runs in JS alongside the game loop. It observes player actions via engine events, maintains a world state model, and uses AI to generate story beats, dialogue, and quest mutations in real-time. It writes back into the existing dialogue and quest systems.

```
Engine events → NarrativeDirector (JS)
                    ↓
               World State Model (player actions, NPC states, quest progress)
                    ↓
               AI Story Generator (periodic, event-triggered)
                    ↓
               DialogueStore mutations + Quest mutations + NPC behavior changes
```

### Phase 1: World State Tracking + Story Beats

1. **WorldStateTracker** aggregates player actions into a narrative context.
   - File: `web/src/lib/ai/narrativeDirector/worldState.ts`
   - Tracks: entities destroyed, NPCs interacted with, quests completed, areas explored, items collected, time elapsed, player death count.
   - Produces a `WorldStateSummary` (JSON, < 2KB) for AI prompts.
   - Ring buffer of last 50 significant events.

2. **StoryBeatGenerator** uses AI to create narrative responses to player actions.
   - File: `web/src/lib/ai/narrativeDirector/storyBeatGenerator.ts`
   - Triggered by: significant world state changes (quest complete, boss defeated, NPC killed, new area entered).
   - AI generates a `StoryBeat`: dialogue lines, NPC mood changes, quest mutations, environment hints.
   - Uses existing AI provider chain with `AI_MODEL_FAST` for low latency.

3. **NarrativeDirector** orchestrates the pipeline.
   - File: `web/src/lib/ai/narrativeDirector/index.ts`
   - Subscribes to engine events (reuses event handler pattern from `useEngineEvents`).
   - Throttled: max 1 AI call per 30s to avoid API spam.
   - Outputs feed into: `dialogueStore` (new dialogue nodes), `questGenerator` (quest mutations), NPC memory (PF-580).

4. **MCP commands**: `set_narrative_rules`, `get_narrative_state`, `trigger_story_beat`, `set_narrative_theme`.

### Phase 2: Consequence System

5. **ConsequenceEngine** tracks cause-and-effect chains.
   - Player action → immediate consequence → delayed consequence → world change.
   - Example: Kill shopkeeper → shop closes → prices rise elsewhere → bounty placed.
   - AI generates consequence chains, stored as `ConsequenceChain[]`.

6. **Dynamic dialogue injection** -- NarrativeDirector inserts AI-generated dialogue nodes into existing trees based on world state.

### Phase 3: Multi-Playthrough Coherence

7. Story bible: AI maintains a running narrative summary that constrains future generation for consistency.
8. Faction system integration with consequence engine.
9. Ending generator: AI composes unique endings based on player journey.

### Rust Changes (Phase 1)

| File | Change |
|------|--------|
| `engine/src/core/narrative.rs` | New: `NarrativeStateData` component (theme, active beats) |
| `engine/src/core/pending/game.rs` | Add `NarrativeUpdateRequest` |
| `engine/src/core/commands/game.rs` | Add `set_narrative_rules`, `get_narrative_state` |
| `engine/src/bridge/game.rs` | Emit narrative state on selection |

### Web Changes (Phase 1)

| File | Change |
|------|--------|
| `web/src/lib/ai/narrativeDirector/worldState.ts` | New: World state aggregator |
| `web/src/lib/ai/narrativeDirector/storyBeatGenerator.ts` | New: AI story beat generation |
| `web/src/lib/ai/narrativeDirector/index.ts` | New: Orchestrator |
| `web/src/lib/chat/handlers/dialogueHandlers.ts` | Add narrative MCP handlers |
| `web/src/stores/slices/gameSlice.ts` | Add narrative director state |
| `web/src/components/editor/NarrativeDirectorPanel.tsx` | New: theme, rules, event log |

## Constraints

- **AI latency**: Story beat generation takes 2-5s. Buffer beats ahead; never block gameplay.
- **Coherence**: AI prompt includes a 500-token story summary to prevent contradictions.
- **Token budget**: Max 1 AI call per 30s during play. Configurable per-game.
- **Determinism**: Story beats are logged with seeds for replay debugging.
- **Export**: NarrativeDirector runs in exported games (script worker). Requires AI API key in exported game config or falls back to pre-generated beat pool.

## Acceptance Criteria

- Given a player who kills an NPC, When the NarrativeDirector processes this event, Then a story beat is generated with appropriate consequences (e.g., allied NPCs become hostile).
- Given active narrative rules ("medieval fantasy, honor-based"), When AI generates dialogue, Then it matches the specified tone and theme.
- Given a 10-minute play session with varied actions, When narrative state is queried, Then a coherent world state summary reflects all significant events.
- Given no AI API access, When narrative is active, Then pre-generated fallback beats from the beat pool are used.

## Phase 1 Subtasks

1. Create `WorldStateTracker` with event aggregation and ring buffer
2. Create `StoryBeatGenerator` with AI prompt construction and response parsing
3. Create `NarrativeDirector` orchestrator with throttling and event subscription
4. Add `NarrativeStateData` ECS component for persistence
5. Create `NarrativeDirectorPanel.tsx` with theme config and event log viewer
6. Add MCP handlers: `set_narrative_rules`, `get_narrative_state`, `trigger_story_beat`
7. Add unit tests for WorldStateTracker, StoryBeatGenerator, and throttle logic
