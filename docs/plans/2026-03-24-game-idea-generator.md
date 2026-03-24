# Spec: Game Idea Generator

> **Status:** DRAFT
> **Date:** 2026-03-24
> **Ticket:** PF-573

## Problem

New users open SpawnForge and face a blank canvas. The biggest friction point is "What should I make?" A game idea generator that combines trending genres, proven mechanics, and creative constraints would lower the barrier to starting a project.

## Solution

An AI-powered idea generator that produces structured game concepts with genre, mechanics, art style, scope estimate, and a one-click "Start from idea" button that scaffolds a project using existing game templates and compound AI actions.

### Phase 1: Idea Generator API + UI (MVP)

**Web Changes:**
- `web/src/lib/generate/ideaGenerator.ts` — Builds prompts from user preferences (genre inclinations, target platform, complexity level) combined with a curated mechanics database
- `web/src/lib/generate/mechanicsDb.ts` — Static database of ~60 game mechanics (physics puzzles, time manipulation, stealth, base building, etc.) with genre compatibility tags
- `web/src/lib/generate/ideaSchema.ts` — Zod schema: `GameIdea` (title, elevator pitch, genre, mechanics[], artStyle, estimatedScope, templateMatch)
- `web/src/app/api/generate/idea/route.ts` — POST route. Accepts `{ preferences, constraints, count }`. Returns 1-5 structured game ideas. Token-gated (low cost: ~300 tokens per idea)
- `web/src/lib/chat/handlers/ideaHandlers.ts` — MCP handlers

**MCP Commands (4):**
- `generate_game_ideas` — Produces N game ideas based on preferences and constraints
- `get_idea_details` — Expands a brief idea into a full game design document outline
- `start_from_idea` — Scaffolds a new project: selects matching template, sets project type (2D/3D), names scenes, generates initial entity layout via `create_scene` compound action
- `remix_idea` — Takes an existing idea and mutates one dimension (swap genre, add mechanic, change art style)

**UI Components:**
- `web/src/components/editor/IdeaGeneratorModal.tsx` — Modal launched from WelcomeModal "Need inspiration?" button. Displays cards with genre tags, mechanics pills, and "Start" button
- Integrates with existing `WelcomeModal` and `onboardingStore`

### Phase 2: Trending & Community Ideas

- Aggregate anonymized genre/mechanic frequency from published games (read from `community/games` API)
- "Trending this week" section showing popular genre combinations
- Community idea voting (like/save) on shared ideas

### Phase 3: Idea-to-Prototype Pipeline

- "Start from idea" generates a multi-scene project skeleton with placeholder entities
- Auto-applies game components (CharacterController, Health, Collectible) based on mechanics list
- Generates starter scripts for core mechanics

## Constraints

- Mechanics database is static (bundled, not fetched) — fast, no network dependency
- Idea generation uses minimal tokens (~300 per idea) to keep costs low
- `start_from_idea` reuses existing `create_scene` compound action — no new engine commands
- No user data collection beyond anonymized genre frequencies from public games

## Acceptance Criteria

- Given a user selects "2D platformer" and "physics puzzles", When `generate_game_ideas` is called with count=3, Then 3 valid GameIdea objects are returned with matching genre and mechanics
- Given a generated idea with `templateMatch: "platformer"`, When `start_from_idea` is called, Then a new project is scaffolded using the platformer template with named scenes
- Given the mechanics database, When any mechanic is looked up, Then it has genre compatibility tags and a one-line description
- Given no preferences provided, When `generate_game_ideas` is called, Then random diverse ideas across genres are returned

## Alternatives Considered

- **Template-only approach:** Rejected — existing 5 templates are too rigid. AI generation with template fallback provides novelty while maintaining structure.
- **Community-sourced ideas only:** Rejected for Phase 1 — requires critical mass of published games. AI generation works from day one.
