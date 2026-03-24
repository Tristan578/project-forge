# Spec: Smart Camera System

> **Status:** DRAFT
> **Date:** 2026-03-24
> **Ticket:** PF-565
> **Scope:** AI-driven camera configuration based on game genre, scene analysis, and dramatic moments

## Problem

Creators manually configure camera settings (mode, FOV, follow distance, smoothing) without knowing
what works well for their game genre. A platformer needs tight follow with look-ahead; an RPG needs
wide orbit with slow pan; horror needs narrow FOV with lag. Getting this wrong makes games feel bad.

The existing `smartCamera.ts` has genre presets and a heuristic scoring system, but lacks:
1. AI-powered genre detection from GDD/scene context (currently keyword-matching only)
2. Auto-cinematic cuts triggered by dramatic gameplay moments
3. A chat handler so creators can say "set up the camera for my horror game"

## Solution

Wire the existing `smartCamera.ts` infrastructure to the AI chat pipeline and add cinematic event
triggers. No Rust engine changes needed -- camera configuration uses existing `set_game_camera` and
`set_active_game_camera` MCP commands.

### Phase 1: AI-Powered Genre Detection (This Spec)

Replace the keyword-matching `generateEconomy()` stub in `smartCamera.ts` with an AI call that
reads GDD + scene context and returns a `CameraPreset`.

### Phase 2: Auto-Cinematic Cuts (Future)

Detect dramatic gameplay events (boss spawn, NPC death, treasure found) in play mode and trigger
camera animation sequences (zoom, DOF, shake).

## Design

### Existing Code (No Changes Needed)
- `web/src/lib/ai/smartCamera.ts` -- Types, 8 presets, `detectOptimalCamera()`, `cameraToCommands()`, `interpolatePresets()`
- Engine `set_game_camera` / `set_active_game_camera` commands (6 camera modes already supported)
- `GameCamera` ECS component with all follow/orbit/FPS/topdown parameters

### Web Changes

#### 1. AI Chat Handler (`web/src/lib/chat/handlers/cameraHandlers.ts` -- NEW)

Register handler for tool name `configure_smart_camera`:
- Reads GDD genre from `chatStore` or scene context from `editorStore`
- Builds prompt: "Given this game genre and scene entities, select the best camera preset and
  explain why. Return JSON matching CameraPreset schema."
- Calls AI via `web/src/lib/ai/client.ts` (existing streaming infrastructure)
- Validates AI response against `CameraPreset` schema using `schemaValidator.ts`
- Dispatches `cameraToCommands()` result via `dispatchCommand()`
- Returns natural language explanation of camera choice

#### 2. Upgrade `smartCamera.ts` Generation

Replace the stub `detectOptimalCamera()` call path with:
```
sceneContext + GDD genre
  -> AI prompt (structured output)
  -> validate against CameraPreset schema
  -> fallback to heuristic detectOptimalCamera() if AI fails
```

Token budget: ~500 input tokens (scene context) + ~200 output tokens (preset JSON). Well within
single-action budget.

#### 3. MCP Command (`mcp-server/manifest/commands.json`)

Add `configure_smart_camera` command:
- Parameters: `genre` (optional string), `entityId` (required, camera entity)
- If genre omitted, AI infers from GDD + scene
- Returns: camera preset applied, explanation string

#### 4. Store Integration

No new store slice needed. Camera state already lives in `gameSlice` (`gameCameraData`).
The handler dispatches `set_game_camera` which updates the existing ECS component.

### Rust Changes

None. All 6 camera modes and their parameters already exist in the GameCamera system.
The `set_game_camera` command already accepts all fields the presets produce.

### AI Prompt Design

System prompt (cached per session via `promptCache.ts`):
```
You are a game camera director. Given a game's genre, scene entities, and mood,
select optimal camera settings. Return valid JSON matching this schema:
{name, genre, mode, followDistance, followHeight, followSmoothing, fov, lookAhead,
deadZone: {x, y}, shake: {enabled, trauma, decay}}

Mode must be one of: follow, fixed, orbit, side_scroll, top_down, first_person.
```

User prompt (per invocation):
```
Game genre: {genre from GDD or user input}
Scene entities: {top 20 entity names + component types}
Project type: {2d | 3d}
Current camera: {current mode + settings}
User request: {natural language, e.g. "make it feel more cinematic"}
```

### Test Plan

**Unit tests** (`web/src/lib/ai/__tests__/smartCamera.test.ts` -- EXISTS, extend):
- AI response parsed into valid CameraPreset
- Invalid AI response falls back to heuristic detection
- Genre override parameter takes priority over AI inference
- Token budget respected (mock budget manager)

**Integration tests** (`web/src/lib/chat/handlers/__tests__/cameraHandlers.test.ts` -- NEW):
- Chat message "set up camera for horror game" dispatches `set_game_camera` with horror preset
- Missing camera entity returns helpful error
- AI provider failure gracefully falls back to preset selection

## Acceptance Criteria

- Given a platformer game, When user says "configure camera", Then tight follow with look-ahead is applied
- Given AI provider is down, When camera configured, Then heuristic fallback produces a valid preset
- Given a camera preset is applied, When user undoes, Then previous camera settings are restored
- Given MCP tool `configure_smart_camera`, When called with genre="horror", Then horror preset applied

## Constraints

- Token budget: < 1000 tokens per invocation (prompt + response)
- Latency: < 3s for AI response, < 100ms for heuristic fallback
- No new Rust code -- reuse existing GameCamera infrastructure entirely
- Must work in both 2D and 3D project types (side_scroll preset for 2D)

## Phase 1 Subtasks

1. Create `cameraHandlers.ts` chat handler with AI integration
2. Add `configure_smart_camera` to MCP manifest + web copy
3. Wire handler into `executor.ts` handler registry
4. Add unit tests for AI response parsing and fallback
5. Add integration tests for chat-to-command pipeline
6. Update `ToolCallCard.tsx` with display label for new tool
