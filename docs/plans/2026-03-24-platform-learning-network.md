# Spec: Platform Learning Network

> **Status:** DRAFT -- Awaiting Approval
> **Date:** 2026-03-24
> **Ticket:** PF-560
> **Scope:** Every game created on SpawnForge makes the AI smarter at game creation

## Problem

SpawnForge's AI treats every game creation session as independent. It does not learn from:
- What prompts produce good games (user satisfaction signals).
- Common entity compositions that work well together (e.g., "platformer player" = capsule + physics + input + jump script).
- Patterns across thousands of scenes (lighting setups, level layouts, game feel tuning).

This means the 1000th user to ask "make a platformer" gets the same quality as the 1st. The platform does not get smarter over time. Competing AI tools that leverage usage data will eventually outperform us.

## Existing Infrastructure

- **328 MCP commands** with structured parameters -- every AI action is logged.
- **Chat route** (`web/src/app/api/chat/route.ts`) streams AI responses with tool calls.
- **Scene context** (`web/src/lib/chat/context.ts`) serializes current scene for AI.
- **`.forge` scene format** is JSON -- fully parseable.
- **Game templates** (`web/src/lib/export/presets.ts`) are hardcoded presets (5 templates).
- **Published games** table tracks play count, ratings, tags.
- **PostHog** tracks user events. **Sentry** tracks errors.

The gap is a **feedback loop** that turns usage data into better AI outputs.

## Solution

### Architecture: Three-Layer Learning Pipeline

```
Layer 1: Signal Collection (passive, zero user friction)
  - Command sequences from successful sessions
  - Scene snapshots at publish time
  - User satisfaction signals (publish, play count, rating)
  - Error patterns (failed commands, retries)

Layer 2: Pattern Extraction (batch, offline)
  - Cluster successful scenes by genre/type
  - Extract "recipes" (command sequences that produce good outcomes)
  - Identify common entity compositions
  - Build prompt-to-scene quality mapping

Layer 3: AI Enhancement (runtime, per-request)
  - Inject relevant recipes into system prompt
  - Suggest entity compositions based on context
  - Auto-tune parameters using learned distributions
  - Rank template suggestions by similarity to request
```

### Phase 1: Signal Collection

Passive data collection with zero impact on user experience.

#### Web Changes

1. **`web/src/lib/analytics/sessionRecorder.ts`** -- Capture command sequences per session.
   - Record: `{ sessionId, userId, timestamp, command, params, success, sceneContext }`.
   - Buffer in memory (max 200 events), flush to server every 60s or on session end.
   - Strips PII: no chat text, no user names. Only command names + parameters + entity types.
   - Respects cookie consent -- no recording if analytics consent is denied.

2. **`web/src/app/api/analytics/sessions/route.ts`** -- Session data ingestion endpoint.
   - POST: accept session event batch (max 200 events, max 100KB).
   - Rate limited: 1 req/min per user.
   - Validate event schema, reject malformed data.
   - Store in Neon (append-only, partitioned by month).

3. **`web/src/lib/analytics/publishSignal.ts`** -- Capture scene snapshot at publish time.
   - When a game is published, serialize the scene graph (entity types, component configurations, hierarchy) as a "recipe."
   - Attach metadata: genre tags, entity count, command count to create, user tier.
   - Store as JSONB in `scene_recipes` table.

#### DB Changes

4. **`web/src/lib/db/schema.ts`** -- New tables.
   ```
   session_events: id, session_id, user_id, command, params_json (jsonb),
     success (boolean), entity_count (int), created_at
     -- Partitioned by created_at month

   scene_recipes: id, game_id (FK published_games), genre, entity_types (text[]),
     component_summary (jsonb), command_sequence (jsonb), quality_score (float),
     play_count (int), avg_rating (float), created_at
   ```

5. **Quality score computation** (cron job, daily):
   - `quality_score = 0.4 * normalized_play_count + 0.3 * normalized_rating + 0.2 * publish_signal + 0.1 * completeness_score`
   - `completeness_score` = fraction of common components present (physics, input, win condition, etc.)
   - Only published games with 10+ plays contribute to recipes.

### Phase 2: Pattern Extraction

Batch processing to extract reusable patterns from collected data.

6. **`web/src/app/api/cron/extract-patterns/route.ts`** -- Daily cron job.
   - Query `scene_recipes` where `quality_score > 0.6`.
   - Cluster by genre tag (platformer, puzzle, shooter, RPG, etc.).
   - For each cluster, extract:
     - **Entity compositions**: groups of components that appear together (e.g., player = mesh + physics + input + script).
     - **Parameter distributions**: typical values for physics gravity, light intensity, camera distance.
     - **Command sequences**: common orderings (spawn entities, then add physics, then add scripts, then test).
   - Output: `pattern_library` table rows.

7. **`web/src/lib/db/schema.ts`** -- Pattern library table.
   ```
   pattern_library: id, genre, pattern_type (entity_composition | parameter_distribution | command_sequence),
     pattern_name, pattern_data (jsonb), sample_count (int), confidence (float),
     created_at, updated_at
   ```

   Example `pattern_data` for entity composition:
   ```json
   {
     "name": "Platformer Player",
     "entities": [
       { "type": "Capsule", "components": ["PhysicsData", "InputMap", "ScriptData"] }
     ],
     "typical_params": {
       "physics": { "mass": 1.0, "friction": 0.5, "restitution": 0.0 },
       "gravity": -9.81
     },
     "source_games": 47,
     "avg_quality": 0.78
   }
   ```

### Phase 3: AI Enhancement

Inject learned patterns into the AI pipeline at request time.

8. **`web/src/lib/chat/recipeInjector.ts`** -- Context enrichment.
   - Before sending chat message to LLM, detect intent (genre, feature type).
   - Query `pattern_library` for relevant patterns (top 3 by confidence).
   - Inject as system prompt addendum: "Based on 47 successful platformer games on SpawnForge, the typical player entity uses: Capsule mesh, mass 1.0, friction 0.5, with jump script. Consider using these proven parameters."
   - Cap injected context to 500 tokens to avoid prompt bloat.

9. **`web/src/lib/chat/templateSuggester.ts`** -- Smart template ranking.
   - When user starts a new project, rank templates by similarity to their description.
   - Use keyword overlap + genre classification from pattern library.
   - Replace hardcoded 5-template list with dynamically ranked suggestions.

10. **`web/src/components/editor/RecipeSuggestionPanel.tsx`** -- Optional UI for pattern suggestions.
    - "Based on similar games, you might want to add: physics to Player, a win condition, background music."
    - Non-intrusive: appears in sidebar, dismissable, respects "don't show again."

## Constraints

- **Privacy first** -- No chat text, no scene content, no user names in analytics. Only structured command data and anonymized scene metadata.
- **No training on user content** -- We do not fine-tune models on user scenes. Patterns are statistical aggregates (parameter distributions, component co-occurrence).
- **Opt-out** -- Users can disable analytics contribution in settings. Recipes from opted-out users are excluded.
- **Cold start** -- Phase 3 requires ~100 published games with ratings to produce useful patterns. Until then, fall back to hardcoded templates.
- **No real-time ML** -- All pattern extraction is batch (daily cron). No model inference in the hot path. Recipe injection is a DB lookup, not ML inference.
- **Storage budget** -- Session events: ~1KB/event, ~200 events/session, ~100 sessions/day = ~20MB/day. Partition monthly, retain 6 months. Pattern library: negligible (<1MB).
- **Cron budget** -- Pattern extraction: < 5 minutes on Vercel cron (process at most 1000 recipes per run).

## Performance Budgets

| Operation | Budget |
|-----------|--------|
| Session event buffering | < 1ms per event (in-memory append) |
| Session flush (200 events) | < 500ms (single POST) |
| Recipe injection (Phase 3) | < 50ms (DB query + prompt assembly) |
| Pattern extraction cron | < 5 min per run |
| Template ranking | < 100ms |

## Acceptance Criteria

- Given a user creates a platformer and publishes it, When the daily cron runs, Then the scene's entity composition appears in `scene_recipes` with a computed quality score.
- Given 50+ published platformers exist with ratings, When a new user asks "make a platformer", Then the AI system prompt includes learned parameter suggestions (gravity, player mass, etc.).
- Given a user has opted out of analytics, When they create and publish a game, Then no session events or scene recipes are stored for that user.
- Given the pattern library has a "Platformer Player" composition, When a user creates a player entity, Then the recipe suggestion panel shows "Add physics (mass: 1.0) and input bindings? 47 similar games use this setup."
- Given the session event buffer is full (200 events), When a new event occurs, Then the buffer flushes to the server and resets.

## Alternatives Considered

1. **Fine-tune a game-creation model** -- Rejected. Requires massive data (10K+ games), expensive training, model versioning complexity. Statistical aggregates achieve 80% of the value at 1% of the cost.
2. **RAG over scene files** -- Considered. Embedding full `.forge` scenes into a vector DB and retrieving similar scenes. Deferred -- adds vector DB infrastructure. Pattern library is simpler and sufficient for Phase 1-3.
3. **Client-side pattern matching** -- Rejected. Patterns must aggregate across all users, requiring server-side data.
4. **Real-time collaborative filtering** -- Rejected. "Users who built X also built Y" requires session-level tracking and real-time inference. Too complex for Phase 1.

## Phased Delivery

| Phase | Scope | Effort |
|-------|-------|--------|
| 1 | Signal collection (session events, publish recipes) | ~3 days |
| 2 | Pattern extraction (cron job, pattern library) | ~3 days |
| 3 | AI enhancement (recipe injection, template ranking, suggestion panel) | ~4 days |
