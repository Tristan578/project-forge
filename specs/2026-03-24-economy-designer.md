# Spec: Economy Designer

> **Status:** DRAFT
> **Date:** 2026-03-24
> **Ticket:** PF-566
> **Scope:** AI generates balanced in-game economies from game mechanics descriptions

## Problem

Game economy design requires expertise in progression curves, inflation prevention, and loot table
balancing. Most creators set item prices by gut feeling, leading to economies where players are
either stuck (poverty) or overpowered (inflation).

The existing `economyDesigner.ts` has a rich type system, 5 system-archetype presets (named after common game patterns like RPG or roguelike, but usable for any system composition), a validation engine
(`validateBalance()`), and script generation (`economyToScript()`). But the AI integration is a
stub -- `generateEconomy()` just does keyword matching to select a preset. Creators cannot describe
their game mechanics in natural language and get a custom economy.

## Solution

Wire the existing economy infrastructure to the AI chat pipeline. The AI generates a `GameEconomy`
JSON that passes through the existing `validateBalance()` before being applied. If validation
fails, the AI is asked to fix the issues (self-healing loop, max 2 retries).

### Phase 1: AI Economy Generation (This Spec)

Replace keyword-matching stub with real AI call. Add chat handler and MCP command.

### Phase 2: Economy Simulation (Future)

Run a Monte Carlo simulation of N play-hours to detect inflation/poverty points before applying.

## Design

### Existing Code (Leveraged, Not Changed)

- `web/src/lib/ai/economyDesigner.ts` -- Types (`GameEconomy`, `Currency`, `ShopItem`, `LootTable`,
  `ProgressionCurve`), 5 presets, `validateBalance()`, `economyToScript()`
- GameComponent system -- existing ECS components for stats, health, collectibles
- Script sandbox -- generated economy scripts run in Web Worker via `forge.*` API

### Web Changes

#### 1. AI Chat Handler (`web/src/lib/chat/handlers/economyHandlers.ts` -- NEW)

Register handler for tool name `design_economy`:
- Reads GDD mechanics from `chatStore` or accepts natural language description
- Builds structured prompt requesting `GameEconomy` JSON
- Calls AI via `client.ts`, validates response against `GameEconomy` schema
- Runs `validateBalance()` on AI output
- If validation fails with errors: re-prompts AI with issues (max 2 retries)
- On success: stores economy config, optionally generates script via `economyToScript()`
- Returns natural language summary: currencies, item count, balance score

#### 2. Upgrade `economyDesigner.ts` `generateEconomy()`

Replace keyword matching with:
```
description + GDD context
  -> AI prompt (structured output, GameEconomy schema)
  -> validateBalance()
  -> if errors: re-prompt with issues (max 2 retries)
  -> fallback to closest preset if all retries fail
```

#### 3. MCP Command (`mcp-server/manifest/commands.json`)

Add `design_economy` command:
- Parameters: `description` (required string), `preset` (optional, one of preset keys),
  `generateScript` (optional boolean, default false)
- Returns: `GameEconomy` JSON, `BalanceReport`, optional script string

#### 4. Economy Review Panel (`web/src/components/editor/EconomyPanel.tsx` -- NEW)

Displays generated economy in a structured view:
- Currency cards with earn rates and sinks
- Shop item table sortable by price/level
- Loot table visualization with probability bars
- Balance score badge (green/yellow/red)
- "Rebalance" button re-runs AI with current economy as context
- "Generate Script" button calls `economyToScript()` and opens script editor

### Rust Changes

None. Economy is entirely JS-side metadata. The generated script runs in the Web Worker sandbox.
GameComponent stats (health, collectible values) are set via existing `set_game_component` command.

### AI Prompt Design

System prompt:
```
You are a game economy designer. Generate a balanced in-game economy as JSON.
The economy must have: currencies with earn rates and sinks, shop items with
prices and unlock levels, loot tables with weighted entries, and a progression
curve with XP and rewards per level.

Rules:
- All prices must be positive integers
- Loot table weights must be positive, will be normalized to probabilities
- Shop item unlock levels must not exceed progression level count
- Every currency must have at least one sink
- Progression XP curve should be exponential (base 1.1-1.3)

Return valid JSON matching the GameEconomy schema.
```

User prompt:
```
Game description: {user input}
System profile: {from GDD systems if available, e.g., "progression:levels + challenge:combat + feedback:collectibles"}
Target play hours: {estimated session length}
Monetization: {none | cosmetic-only | premium-currency}
{if retry: "Previous attempt had these issues: {BalanceIssue[].message}. Fix them."}
```

### Test Plan

**Unit tests** (`web/src/lib/ai/__tests__/economyDesigner.test.ts` -- EXISTS, extend):
- AI response parsed into valid GameEconomy
- validateBalance catches inflation risk in AI output
- Self-healing loop: invalid AI output -> re-prompt -> valid output
- All retries exhausted -> fallback to nearest preset
- Token budget check before generation

**Integration tests** (`web/src/lib/chat/handlers/__tests__/economyHandlers.test.ts` -- NEW):
- Chat "design economy for RPG with gold and potions" -> GameEconomy with gold currency
- Generated script is syntactically valid JS
- Rebalance preserves manual price overrides where possible

## Acceptance Criteria

- Given "RPG with gold, potions, weapons", When economy designed, Then currencies + shop + loot + progression generated
- Given AI generates economy with negative prices, When validated, Then self-healing re-prompt fixes them
- Given all AI retries fail, When fallback triggered, Then closest archetype preset returned with warning
- Given economy applied, When user clicks "Generate Script", Then valid JS script produced
- Given MCP tool `design_economy`, When called, Then returns GameEconomy + BalanceReport

## Constraints

- Token budget: < 2000 tokens per invocation (economy JSON is verbose)
- Self-healing retries: max 2 (to cap token cost at ~6000 total worst case)
- Validation must pass before economy is applied (no invalid economies in project)
- Economy data is project-level metadata, not ECS components (stored in scene file)
- Generated scripts must use only `forge.*` API methods that exist in `forgeTypes.ts`

## Phase 1 Subtasks

1. Create `economyHandlers.ts` chat handler with AI + validation loop
2. Add `design_economy` to MCP manifest + web copy
3. Wire handler into `executor.ts` handler registry
4. Create `EconomyPanel.tsx` inspector component (read-only view of economy)
5. Register panel in `panelRegistry.ts` and wire into workspace
6. Add unit tests for AI parsing, validation loop, and fallback
7. Add integration tests for chat-to-economy pipeline
8. Update `ToolCallCard.tsx` with display label
