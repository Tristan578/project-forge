# Spec: Cinematic Cutscene Generator

> **Status:** DRAFT
> **Date:** 2026-03-24
> **Ticket:** PF-570

## Problem

Creating cinematic sequences (camera movements, dialogue timing, entity animations) requires frame-by-frame manual work. Users need an AI tool that generates timeline-based cutscenes from natural language descriptions, leveraging existing camera modes, keyframe animation, and dialogue systems.

## Solution

Cutscenes are timeline data structures that orchestrate existing subsystems: camera commands, keyframe animations, dialogue trees, and audio cues. The AI generates a cutscene timeline; a new store manages playback; the runtime executes it by dispatching commands in sequence.

### Phase 1: Cutscene Data Model + Generator (MVP)

**Web Changes:**
- `web/src/stores/cutsceneStore.ts` — Zustand store. Types: `Cutscene`, `CutsceneTrack` (camera, dialogue, animation, audio, wait), `CutsceneKeyframe` with timestamp/duration/easing
- `web/src/app/api/generate/cutscene/route.ts` — POST route. Accepts `{ prompt, sceneEntities, duration }`. AI produces timeline JSON. Token-gated
- `web/src/lib/generate/cutsceneSchema.ts` — Zod schema for cutscene output validation
- `web/src/lib/chat/handlers/cutsceneHandlers.ts` — MCP handlers: `generate_cutscene`, `play_cutscene`, `list_cutscenes`, `update_cutscene_track`, `delete_cutscene`

**MCP Commands (5):**
- `generate_cutscene` — AI-generates a cutscene timeline from prompt + scene context
- `play_cutscene` — Enters play mode and executes the cutscene timeline
- `list_cutscenes` — Returns all cutscenes in the project
- `update_cutscene_track` — Modifies a track's keyframes or timing
- `delete_cutscene` — Removes a cutscene

**Playback Engine (JS-side):**
- `web/src/lib/cutscene/player.ts` — `CutscenePlayer` class. Uses `requestAnimationFrame` loop, dispatches engine commands at scheduled timestamps: `set_game_camera` for camera moves, `trigger_animation_clip` for entity animations, dialogue store mutations for text

### Phase 2: Timeline Editor

- `web/src/components/editor/CutsceneTimeline.tsx` — Horizontal timeline with drag-and-drop tracks
- Snap-to-grid timing, preview playback, track muting
- Wire into `panelRegistry.ts`

### Phase 3: Export Runtime

- Cutscene data bundled as JSON in export package
- `forge.cutscene.*` script API: `play(id)`, `skip()`, `onComplete(cb)`
- Auto-pause game input during cutscene playback

## Constraints

- Cutscene playback uses existing command pipeline (no new Rust systems)
- Maximum 60 seconds per cutscene (prevents memory bloat in timeline data)
- Camera interpolation uses existing `set_game_camera` with lerp — no custom camera system
- Works in both WebGPU and WebGL2 (no GPU-specific features)

## Acceptance Criteria

- Given a prompt "Dramatic camera pan from sky to player, then dialogue between two NPCs", When `generate_cutscene` is called with scene context, Then a timeline with camera track + dialogue track is produced
- Given a cutscene with 3 tracks, When `play_cutscene` is called, Then the editor enters play mode and commands fire at correct timestamps (+/- 16ms)
- Given a cutscene playing, When the user presses Escape, Then playback stops and the editor returns to edit mode
- Given an exported game with cutscenes, When `forge.cutscene.play(id)` is called in a script, Then the cutscene plays in the runtime

## Alternatives Considered

- **Rust-side cutscene system:** Rejected — cutscenes orchestrate existing commands and don't need per-frame ECS access. JS scheduling via rAF is sufficient and avoids WASM complexity.
- **Video recording approach:** Rejected — pre-rendered video loses interactivity and bloats export size.
