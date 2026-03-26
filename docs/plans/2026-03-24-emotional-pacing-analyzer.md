# Spec: Emotional Pacing Analyzer

> **Status:** DRAFT
> **Date:** 2026-03-24
> **Ticket:** PF-572

## Problem

Game creators struggle with pacing — levels feel monotonous because there is no tool to visualize emotional intensity over time. Professional game designers use pacing curves (tension/release cycles), but our users have no way to analyze or optimize the emotional arc of their game.

## Solution

An AI-powered analysis tool that reads the game's scene graph, scripts, dialogue trees, quest objectives, audio settings, and game components to produce an emotional pacing curve. Pure web-layer feature — reads existing data, produces visualization, and suggests improvements.

### Phase 1: Pacing Analysis Engine + API (MVP)

**Web Changes:**
- `web/src/lib/analysis/pacingAnalyzer.ts` — Extracts pacing signals from store state: combat density (damage zones, spawners), collectible density, dialogue length, audio intensity (BPM via bus config), camera mode changes, scene transition frequency
- `web/src/lib/analysis/pacingTypes.ts` — Types: `PacingSegment` (timeRange, intensity 0-1, emotion tag), `PacingCurve` (segments[]), `PacingReport` (curve, suggestions[])
- `web/src/app/api/generate/pacing/route.ts` — POST route. Sends extracted signals to AI for narrative analysis. Returns structured pacing report with suggestions. Token-gated
- `web/src/lib/chat/handlers/analysisHandlers.ts` — MCP handlers

**MCP Commands (3):**
- `analyze_pacing` — Runs pacing analysis on the current scene/project and returns the pacing curve
- `get_pacing_suggestions` — Returns AI-generated suggestions for improving emotional pacing
- `apply_pacing_suggestion` — Auto-applies a suggestion (e.g., "add a rest area after the boss fight" dispatches entity spawn commands)

### Phase 2: Pacing Visualization Panel

- `web/src/components/editor/PacingPanel.tsx` — SVG line chart showing intensity over game progression (X = scene/level index, Y = intensity 0-1)
- Color-coded segments: green (calm), yellow (rising), red (peak), blue (resolution)
- Hover tooltips showing contributing factors per segment
- Wire into `panelRegistry.ts`

### Phase 3: Comparative Analysis

- Compare pacing curves against system-composition archetypes (movement-heavy games = frequent peaks, logic-heavy games = gradual rise, tension-driven games = sustained tension with sharp drops). Genre labels like "platformer" or "horror" are shorthand for these system profiles, not hard constraints
- "Pacing score" — 0-100 rating based on variance, climax placement, resolution presence

## Constraints

- Analysis is read-only — never modifies scene data without explicit `apply_pacing_suggestion`
- Signal extraction must be O(n) in entity count (single pass over scene graph)
- AI analysis limited to project context already available in stores (no new data collection)
- Pacing curve limited to 100 segments max (one per scene or level section)

## Acceptance Criteria

- Given a project with 5 scenes containing combat, dialogue, and collectibles, When `analyze_pacing` is called, Then a PacingCurve with 5 segments and intensity values is returned
- Given a flat pacing curve (all segments intensity 0.3-0.4), When `get_pacing_suggestions` is called, Then at least 2 actionable suggestions are returned (e.g., "Add a climax in scene 3")
- Given a suggestion "Add a damage zone to scene 3", When `apply_pacing_suggestion` is called, Then the appropriate spawn command is dispatched
- Given a project with no game components, When `analyze_pacing` is called, Then a report with intensity 0 and a suggestion to "Add gameplay elements" is returned

## Alternatives Considered

- **Real-time play session tracking:** Rejected for Phase 1 — requires recording actual gameplay sessions. Static analysis of scene data is simpler and sufficient for initial value.
- **Engine-side analysis:** Rejected — pacing is a high-level design concern, not a per-frame computation. JS-only is appropriate.
