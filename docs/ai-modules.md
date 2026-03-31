# AI Modules Reference

> **Last updated:** 2026-03-30
>
> Stub reference for all modules in `web/src/lib/ai/`. Each module is a standalone TypeScript file used by API routes and chat handlers. For full API details, read the source file — every module has JSDoc on its exported functions.

## Module List

| Module | File | Description |
|--------|------|-------------|
| `accessibilityGenerator` | `accessibilityGenerator.ts` | Generates accessibility recommendations (colorblind modes, subtitle config, control remapping hints) for published games |
| `aiSdkAdapter` | `aiSdkAdapter.ts` | Wraps AI SDK v5 `streamText` and yields `ResolveChatStreamEvent` objects for the chat route |
| `artStyleEngine` | `artStyleEngine.ts` | Ensures visual consistency across AI-generated assets by enforcing a chosen art style profile |
| `autoIteration` | `autoIteration.ts` | AI auto-iteration engine (PF-553) — automatically refines game systems based on playtesting feedback |
| `autoRigging` | `autoRigging.ts` | Auto-rigging pipeline for AI-generated 3D models — infers bone placement from mesh geometry |
| `behaviorTree` | `behaviorTree.ts` | Builds behavior tree node graphs for enemy and NPC AI from natural language descriptions |
| `budgetManager` | `budgetManager.ts` | Tracks cumulative token spend per session and enforces per-tier budget caps |
| `cachedContext` | `cachedContext.ts` | LRU cache for system prompts and scene context passed to Claude — reduces redundant token usage |
| `client` | `client.ts` | Unified AI client for all SpawnForge feature modules — wraps provider routing, retries, and cost logging |
| `contentSafety` | `contentSafety.ts` | Content safety filters for the asset generation pipeline — blocks unsafe prompts before they reach providers |
| `costAnomaly` | `costAnomaly.ts` | Rolling-average cost anomaly detection — alerts when hourly AI spend exceeds 2x the 7-day average |
| `cutsceneGenerator` | `cutsceneGenerator.ts` | Converts a natural-language prompt and scene context into a structured cinematic cutscene sequence |
| `designTeacher` | `designTeacher.ts` | AI-powered game design education — explains design decisions and suggests improvements in-editor |
| `difficultyAdjustment` | `difficultyAdjustment.ts` | Dynamic difficulty adjustment (DDA) — tunes enemy speed, spawn rate, and health based on player performance |
| `economyDesigner` | `economyDesigner.ts` | Generates in-game economy configs (currency sinks/sources, drop rates, shop pricing) from design intent |
| `effectSystem` | `effectSystem.ts` | Unified event-to-effect system ("juice" engine) — maps game events to screen shake, particles, and sound cues |
| `emotionalPacing` | `emotionalPacing.ts` | Analyzes scene pacing and emotional arc, suggests tension/relief curve adjustments |
| `gameModifier` | `gameModifier.ts` | Incremental game modification engine — applies natural-language change requests to an existing scene |
| `gameplayBot` | `gameplayBot.ts` | Automated playtesting bot — simulates player input and reports balance issues and stuck states |
| `gameReviewer` | `gameReviewer.ts` | Analyzes finished game content and generates a structured quality review with actionable suggestions |
| `gddGenerator` | `gddGenerator.ts` | Generates a structured Game Design Document (GDD) from a single-sentence description |
| `ideaGenerator` | `ideaGenerator.ts` | Remixes trending mechanics to generate novel game concepts — feeds the Idea Generator panel |
| `levelGenerator` | `levelGenerator.ts` | Constraint-based procedural level layout generator — produces entity placement arrays from design rules |
| `models` | `models.ts` | Centralized AI model configuration — `AI_MODEL_PRIMARY`, `AI_MODEL_FAST`, provider mapping |
| `narrativeGenerator` | `narrativeGenerator.ts` | Converts a story premise into a full branching narrative arc with acts, beats, and choice points |
| `physicsFeel` | `physicsFeel.ts` | Auto-tunes game physics parameters (gravity, friction, jump height) to match a target feel description |
| `proceduralAnimation` | `proceduralAnimation.ts` | Generates procedural animation clips (idle sway, footstep IK offsets) from character descriptions |
| `promptCache` | `promptCache.ts` | In-memory LRU cache for system prompts — avoids re-building large context strings on every request |
| `providerHealth` | `providerHealth.ts` | Sliding-window provider health monitor — tracks failure rates and routes to fallback providers automatically |
| `questGenerator` | `questGenerator.ts` | Procedural quest/mission generator — produces structured quest trees from a game context and prompt |
| `requestQueue` | `requestQueue.ts` | Priority request queue for the AI client — prevents thundering-herd on AI endpoints during compound actions |
| `saveSystemGenerator` | `saveSystemGenerator.ts` | Generates game save/load logic (checkpoint placement, serializable state schema) from game structure |
| `sceneContext` | `sceneContext.ts` | Serializes the current Bevy scene into a compact context string for AI prompts |
| `schemaValidator` | `schemaValidator.ts` | Validates AI-generated JSON responses against expected schemas before they reach the engine |
| `smartCamera` | `smartCamera.ts` | AI-driven camera preset system — selects and configures camera behavior for different game contexts |
| `spawnforgeAgent` | `spawnforgeAgent.ts` | Reusable `ToolLoopAgent` (AI SDK) for the game engine — orchestrates multi-step scene construction |
| `streaming` | `streaming.ts` | Unified SSE streaming helper for AI generation endpoints — wraps `ReadableStream` with progress events |
| `systemDecomposer` | `systemDecomposer.ts` | Decomposes a game description into composable systems (movement, camera, challenge, etc.) — replaces the deprecated `detectGenre()` approach |
| `texturePainter` | `texturePainter.ts` | Generates texture modification prompts and applies AI-generated texture patches to entities |
| `tierAccess` | `tierAccess.ts` | Tier-based access control for AI panels — gates premium AI features by user subscription tier |
| `toolAdapter` | `toolAdapter.ts` | Converts MCP command manifest tools to AI SDK v5 tool definitions for use in `streamText` calls |
| `tutorialGenerator` | `tutorialGenerator.ts` | Auto-generates in-editor tutorials and tooltips from the current scene's active systems |
| `worldBuilder` | `worldBuilder.ts` | Generates lore, factions, regions, and history from a world concept for RPG and open-world games |

## Key Patterns

- **Client entry point**: Use `client.ts` (`fetchAI`) for all provider calls — it handles routing, retries, and cost logging.
- **Model selection**: Import `AI_MODEL_PRIMARY` or `AI_MODEL_FAST` from `models.ts` — never hardcode model IDs.
- **Streaming responses**: Use `streaming.ts` for SSE endpoints; use `aiSdkAdapter.ts` for the main chat route.
- **Token budgeting**: Every AI call that consumes user tokens must call `budgetManager` and `deductTokens()`.
- **System decomposition**: Use `systemDecomposer.ts` to break game descriptions into systems. The older `detectGenre()` function in `gddGenerator.ts` is deprecated — do not use it for new features.
