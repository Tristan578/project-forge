# Spec: Procedural Quest/Mission Generator

> **Status:** DRAFT
> **Date:** 2026-03-24
> **Ticket:** PF-569

## Problem

Game creators must manually script every quest, which is tedious and limits replayability. An AI-powered quest generator would let users describe high-level goals ("RPG with 10 fetch quests and a boss fight") and receive structured quest trees with objectives, rewards, and dialogue hooks.

## Solution

Pure web-layer feature. No Rust/engine changes needed. Quests are data structures (JSON) that wire into the existing dialogue system, game components, and scripting runtime. The AI generates quest graphs; the editor stores and visualizes them; the runtime evaluates progress via `forge.quest.*` script API.

### Phase 1: Quest Data Model + Generator API (MVP)

**Web Changes:**
- `web/src/stores/questStore.ts` — Zustand store for quest trees. Types: `Quest`, `QuestObjective` (fetch, kill, explore, interact, escort), `QuestReward`, `QuestGraph`
- `web/src/app/api/generate/quest/route.ts` — POST route. Accepts `{ prompt, systemContext, complexity }`. Calls AI provider (Claude via AI SDK) to produce structured quest JSON. Token-gated via `deductTokens()`. The `systemContext` field describes the game's active systems (e.g., movement, challenge, progression) rather than a genre label
- `web/src/lib/generate/questSchema.ts` — Zod schema for generated quest output (validates AI response)
- `web/src/lib/chat/handlers/questHandlers.ts` — MCP handlers: `generate_quest`, `list_quests`, `get_quest`, `update_quest_objective`, `delete_quest`

**MCP Commands (5):**
- `generate_quest` — AI-generates a quest graph from a text prompt
- `list_quests` — Returns all quests in the current project
- `get_quest` — Returns a single quest with objectives and rewards
- `update_quest_objective` — Modifies an objective's type, target, or count
- `delete_quest` — Removes a quest

### Phase 2: Quest Editor Panel

- `web/src/components/editor/QuestEditorPanel.tsx` — Visual quest graph editor (React Flow, reuses visual scripting infrastructure)
- Quest node types: Start, Objective, Branch, Reward, End
- Wire into `panelRegistry.ts` and `WorkspaceProvider`

### Phase 3: Runtime Integration

- `web/src/lib/scripting/forgeQuest.ts` — `forge.quest.*` runtime API (startQuest, completeObjective, getProgress, onQuestComplete)
- Auto-generate script templates that bind quest objectives to game component events (collectible pickups, trigger zones, health depletion)
- Link quest dialogue nodes to existing `dialogueStore` trees

## Constraints

- AI response must be validated against Zod schema before storage
- Quest complexity capped at 50 objectives per quest (O(n) traversal)
- No engine changes: quest state lives entirely in JS stores and scripts
- Token cost: ~500-2000 tokens per generation depending on complexity

## Acceptance Criteria

- Given a user prompt "Create a 5-quest RPG storyline", When `generate_quest` is called, Then a valid QuestGraph with 5 quests and linked objectives is returned
- Given an invalid AI response, When the Zod schema rejects it, Then a retry with stricter prompt is attempted (max 2 retries)
- Given a quest with 3 objectives, When the user edits objective #2 via MCP, Then only that objective updates and the graph remains valid
- Given a generated quest, When exported, Then quest data is bundled as JSON in the exported game package

## Alternatives Considered

- **Engine-side quest ECS:** Rejected — quests are pure data/logic, no rendering. JS-only is simpler and avoids WASM binary bloat.
- **Template-only (no AI):** Rejected — templates alone don't solve the creative bottleneck. AI generation with template fallbacks is the right balance.
