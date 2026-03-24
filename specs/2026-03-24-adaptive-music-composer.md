# Spec: Real-Time Adaptive Music Composer

> **Status:** DRAFT
> **Date:** 2026-03-24
> **Ticket:** PF-581
> **Scope:** AI composes and adapts game music in real-time based on gameplay state

## Problem

SpawnForge has an `AdaptiveMusicManager` that crossfades between pre-recorded stems (pad, bass, melody, drums) based on an intensity value 0-1. This works for curated music but requires creators to provide 4 separate audio stems per track. Most users have zero music production skills. An AI composer would generate stems on-the-fly from a text description ("epic fantasy battle music") and continuously adapt to gameplay.

## Existing Infrastructure

- `web/src/lib/audio/adaptiveMusic.ts` -- `AdaptiveMusicManager` with `loadStemSet()`, `setIntensity()`, `setBPM()`, segment transitions.
- `web/src/lib/audio/audioManager.ts` -- Full Web Audio graph with buses, ducking, spatial audio, snapshots.
- `web/src/lib/generate/` -- AI generation pipeline for textures, sprites, skyboxes (provider chain pattern).
- Suno client exists in tests (`sunoClient.test.ts`).
- Audio bus system with per-bus effects and gain control.

## Solution

### Architecture Overview

Extend the existing `AdaptiveMusicManager` to accept AI-generated stems. The AI composer is a **JS-only service** that generates audio stems via an external music AI API, then feeds them into the existing stem system.

```
User prompt ("dark ambient exploration")
    ↓
MusicComposer (JS) → Music AI API → AudioBuffer stems
    ↓
AdaptiveMusicManager.loadStemSet(stems)
    ↓
Game events → setIntensity() → real-time mix changes
```

### Phase 1: AI Stem Generation

1. **MusicComposer** service orchestrates stem generation.
   - File: `web/src/lib/audio/musicComposer.ts`
   - Takes: mood string, BPM, key, genre tags.
   - Calls music generation API (configurable provider: Suno, Udio, or local).
   - Returns 4 stems as `AudioBuffer` objects, all time-aligned to the same BPM/bar count.
   - Caches generated stems in IndexedDB by prompt hash.

2. **MusicPromptBuilder** translates game context into music prompts.
   - File: `web/src/lib/audio/musicPromptBuilder.ts`
   - Inputs: scene metadata (environment type, entity types, lighting mood), current game state.
   - Output: structured prompt for the music AI API.

3. **MCP commands**: `compose_music`, `set_music_mood`, `get_music_state`.
   - File: `web/src/lib/chat/handlers/audioHandlers.ts` -- extend existing.

### Phase 2: Real-Time Adaptation

4. **GameStateToMusicMapper** automatically adjusts intensity from gameplay events.
   - File: `web/src/lib/audio/gameStateMusicMapper.ts`
   - Maps: combat → high intensity, exploration → low, boss → max, death → silence+fade.
   - Subscribes to engine events (same pattern as `highlightScorer`).
   - Exposes rules editor for creators to customize mappings.

5. **Seamless transitions** between AI-generated track sets.
   - Extend `AdaptiveMusicManager` with `queueNextTrackSet()`.
   - Beat-quantized crossfade between current and next stem set.

### Phase 3: Procedural Composition

6. Web Audio API oscillator-based procedural music for zero-latency fallback.
7. AI learns from user feedback (thumbs up/down) to refine future generations.

### Rust Changes

None in Phase 1. The `AudioData` ECS component already supports bus routing. Phase 2 adds:

| File | Change |
|------|--------|
| `engine/src/core/audio.rs` | Add `MusicMoodData` component (mood string, intensity rules) |
| `engine/src/core/pending/audio.rs` | Add `MusicMoodUpdateRequest` |
| `engine/src/core/commands/audio.rs` | Add `set_music_mood` dispatch |

### Web Changes (Phase 1)

| File | Change |
|------|--------|
| `web/src/lib/audio/musicComposer.ts` | New: AI stem generation orchestrator |
| `web/src/lib/audio/musicPromptBuilder.ts` | New: Game context to music prompt |
| `web/src/lib/chat/handlers/audioHandlers.ts` | Add `compose_music`, `set_music_mood` |
| `web/src/stores/slices/audioSlice.ts` | Add composer state (generating, mood, cached tracks) |
| `web/src/components/editor/MusicComposerPanel.tsx` | New: mood input, preview, intensity curve |

## Constraints

- **Generation latency**: Music AI APIs take 10-30s per stem. Show progress, allow cancel.
- **Stem alignment**: All 4 stems must share BPM and bar count. Validate before loading.
- **Cache**: IndexedDB cache keyed by `sha256(prompt+bpm+key)`. Max 20 cached sets (~200MB).
- **Offline**: Cached stems work offline. New generation requires network.
- **Token cost**: Music generation consumes AI tokens. Rate limit to 10 generations per session.
- **Export**: Generated stems are embedded in `.forge` file for exported games.

## Acceptance Criteria

- Given a mood description "tense dungeon crawl", When `compose_music` is called, Then 4 stems (pad/bass/melody/drums) are generated and loaded into AdaptiveMusicManager.
- Given generated stems playing, When game intensity changes, Then stem volumes crossfade smoothly per existing AdaptiveMusicManager behavior.
- Given a previously generated prompt, When the same prompt is requested again, Then cached stems are loaded from IndexedDB without an API call.
- Given no network connection, When compose is attempted, Then a clear error is shown and cached tracks remain available.

## Phase 1 Subtasks

1. Create `MusicComposer` class with provider-agnostic API call + AudioBuffer decode
2. Create `MusicPromptBuilder` with scene metadata analysis
3. Add IndexedDB caching layer for generated stems (keyed by prompt hash)
4. Extend `audioSlice.ts` with composer state (mood, isGenerating, cachedTrackIds)
5. Create `MusicComposerPanel.tsx` with mood input, BPM/key controls, generate button
6. Add MCP handlers: `compose_music`, `set_music_mood`, `get_music_state`
7. Add unit tests for MusicComposer, MusicPromptBuilder, and cache layer
