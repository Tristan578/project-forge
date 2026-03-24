# Spec: World-Building Assistant

> **Status:** DRAFT
> **Date:** 2026-03-24
> **Ticket:** PF-567
> **Scope:** AI generates lore, faction relationships, region maps, and history from a single premise

## Problem

World-building is the most time-consuming part of narrative game creation. Creators need factions
with relationships, regions with biomes, a history timeline, and discoverable lore -- all internally
consistent. Without this, game worlds feel shallow and disconnected.

The existing `worldBuilder.ts` has a complete type system (`GameWorld`, `Faction`, `Region`,
`TimelineEvent`, `LoreEntry`, `WorldRule`), 4 genre presets, and a prompt builder. But it lacks:
1. A chat handler so creators can say "build me a sci-fi world with 4 factions"
2. Validation for internal consistency (faction relationships symmetric, regions connected, lore
   references real timeline events)
3. Integration with the narrative system (PF-549) and NPC behavior trees (PF-545)

## Solution

Wire existing world-builder infrastructure to the AI chat pipeline. Add consistency validation
and a world overview panel. Feed generated world data into downstream systems.

### Phase 1: AI World Generation + Validation (This Spec)

Chat handler, MCP command, consistency validator, and world overview panel.

### Phase 2: Cross-System Integration (Future)

Auto-feed generated factions into NPC behavior trees and narrative arcs.

## Design

### Existing Code (Leveraged, Not Changed)

- `web/src/lib/ai/worldBuilder.ts` -- Types, 4 preset worlds (medieval fantasy, sci-fi, post-apocalyptic, mythological), `buildWorldPrompt()`, `parseWorldResponse()`
- `web/src/lib/ai/narrativeGenerator.ts` -- Narrative arc generation (future integration point)
- `web/src/lib/ai/behaviorTree.ts` -- NPC behavior trees (future integration point)
- `AI_MODEL_PRIMARY` from `models.ts` for AI calls

### Web Changes

#### 1. AI Chat Handler (`web/src/lib/chat/handlers/worldHandlers.ts` -- NEW)

Register handler for tool name `build_world`:
- Accepts premise string (e.g., "sci-fi world with 4 factions fighting over energy crystals")
- Optionally accepts genre, faction count, region count constraints
- Builds structured prompt requesting `GameWorld` JSON
- Calls AI via `client.ts`, validates response against `GameWorld` schema
- Runs `validateWorldConsistency()` (new) on output
- If inconsistencies found: re-prompts with issues (max 2 retries)
- Stores world data in project metadata (alongside GDD)
- Returns natural language world summary

#### 2. Consistency Validator (`worldBuilder.ts` -- ADD function)

`validateWorldConsistency(world: GameWorld): ConsistencyReport`

Checks:
- **Faction symmetry**: If Faction A lists B as "enemy", B must list A as "enemy"
- **Region connectivity**: All regions reachable via `connectedTo` graph (no isolated islands unless intentional)
- **Timeline ordering**: Events sorted chronologically, no duplicate years
- **Lore references**: Every lore entry's `factionsInvolved` (if any) references real faction names
- **Name uniqueness**: No duplicate faction names, region names, or lore titles
- **Relationship completeness**: Every faction has a relationship entry for every other faction

Returns severity-scored issues list, similar to `BalanceReport` in economy designer.

#### 3. MCP Command (`mcp-server/manifest/commands.json`)

Add `build_world` command:
- Parameters: `premise` (required string), `genre` (optional), `factionCount` (optional int 1-10),
  `regionCount` (optional int 1-20)
- Returns: `GameWorld` JSON, `ConsistencyReport`

#### 4. World Overview Panel (`web/src/components/editor/WorldPanel.tsx` -- NEW)

Displays generated world:
- World name, genre, era header
- Faction cards with relationship matrix (color-coded: green=ally, red=enemy, gray=neutral)
- Region list with biome tags and connection graph (simple node-link diagram)
- Timeline as vertical list, chronologically ordered
- Lore entries as expandable accordion
- "Regenerate" button re-runs AI with current world as seed context
- "Export Lore" button generates markdown document

### Rust Changes

None. World-building is entirely JS-side metadata. It does not create ECS entities directly.
Future Phase 2 would use existing `spawn_entity` commands to place environmental storytelling
objects, but that is out of scope here.

### AI Prompt Design

System prompt:
```
You are a world-builder for games. Generate a complete, internally consistent
game world as JSON. The world must have factions with mutual relationships,
regions with biomes and connections, a chronological history timeline, and
discoverable lore entries.

Rules:
- Faction relationships must be symmetric (if A considers B enemy, B considers A enemy)
- All regions must be connected (no isolated islands)
- Timeline events must be chronologically ordered
- Lore entries must reference real faction/region names from the world
- Each faction must have a unique name, territory, and visual identity
- Danger levels are 1-10 integers

Return valid JSON matching the GameWorld schema.
```

User prompt:
```
Premise: {user input}
Genre: {specified or inferred}
Faction count: {1-10, default 3}
Region count: {1-20, default 5}
Tone: {epic | dark | lighthearted | mysterious}
{if retry: "Previous world had these consistency issues: {issues}. Fix them."}
```

### Test Plan

**Unit tests** (`web/src/lib/ai/__tests__/worldBuilder.test.ts` -- EXISTS, extend):
- AI response parsed into valid GameWorld
- Consistency validator catches asymmetric faction relationships
- Consistency validator catches disconnected regions
- Self-healing loop: inconsistent world -> re-prompt -> consistent world
- Fallback to genre preset if all retries fail
- Single-faction world: relationships object is empty (valid edge case)
- 10-faction world: relationship matrix has 90 entries (n*(n-1))

**Integration tests** (`web/src/lib/chat/handlers/__tests__/worldHandlers.test.ts` -- NEW):
- Chat "build a fantasy world with 3 factions" -> GameWorld with 3 factions
- Genre constraint respected in output
- World data persisted in project metadata

## Acceptance Criteria

- Given "3 factions at war over crystals", When world generated, Then 3 factions with mutual enemy relationships
- Given asymmetric relationships in AI output, When validated, Then self-healing fixes them
- Given all retries fail, When fallback triggered, Then closest genre preset returned with warning
- Given world generated, When user views WorldPanel, Then factions, regions, timeline, lore all displayed
- Given MCP tool `build_world`, When called with premise, Then returns GameWorld + ConsistencyReport
- Given 1-faction world requested, When generated, Then world valid with no relationship errors

## Constraints

- Token budget: < 3000 tokens per invocation (worlds are the most verbose AI feature)
- Self-healing retries: max 2 (cap total cost at ~9000 tokens worst case)
- Faction count: 1-10 (UI becomes unusable with > 10 factions in relationship matrix)
- Region count: 1-20 (graph visualization breaks down beyond 20 nodes)
- World data stored as project metadata in `.forge` scene file, not ECS components
- Content safety: AI prompt includes instruction to avoid real-world ethnic/political references

## Phase 1 Subtasks

1. Add `validateWorldConsistency()` function to `worldBuilder.ts`
2. Create `worldHandlers.ts` chat handler with AI + consistency validation loop
3. Add `build_world` to MCP manifest + web copy
4. Wire handler into `executor.ts` handler registry
5. Create `WorldPanel.tsx` inspector component (faction cards, region list, timeline, lore)
6. Register panel in `panelRegistry.ts` and wire into workspace
7. Add unit tests for consistency validator (symmetry, connectivity, uniqueness)
8. Add integration tests for chat-to-world pipeline
9. Update `ToolCallCard.tsx` with display label
