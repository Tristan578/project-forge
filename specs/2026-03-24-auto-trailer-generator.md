# Spec: Auto-Trailer Generator

> **Status:** DRAFT
> **Date:** 2026-03-24
> **Ticket:** PF-578
> **Scope:** AI creates marketing video trailers from gameplay captures

## Problem

Game creators need marketing material to share their games. Recording gameplay, cutting highlights, adding music and titles manually is tedious and requires video editing skills most SpawnForge users do not have. An AI-powered trailer generator would let creators publish polished 30-60s trailers with one click.

## Solution

### Architecture Overview

The trailer generator is a **JS-only feature** -- it does not touch the Rust engine core. It captures canvas frames via `MediaRecorder`, selects highlights via AI analysis, and composites with titles/music using the Web Codecs API.

```
Canvas → MediaRecorder → Blob segments → AI highlight scorer → Web Codecs compositor → MP4
```

### Phase 1: Capture Pipeline (JS only)

1. **CanvasRecorder** service wraps `MediaRecorder` on the game canvas.
   - File: `web/src/lib/trailer/canvasRecorder.ts`
   - Records WebM segments (5s chunks) during play mode.
   - Stores chunks in IndexedDB (`forgeTrailerChunks`) to avoid memory pressure.
   - Exposes `start()`, `stop()`, `getChunks()`.

2. **HighlightScorer** analyzes gameplay events to rank segments.
   - File: `web/src/lib/trailer/highlightScorer.ts`
   - Subscribes to engine events during recording: entity spawns, health changes, collectibles, win conditions, camera movements.
   - Produces `ScoredSegment[]` with timestamp + score + tags.

3. **MCP commands**: `start_trailer_recording`, `stop_trailer_recording`, `get_trailer_highlights`.
   - File: `web/src/lib/chat/handlers/trailerHandlers.ts`
   - Registered in `commands.json` under category `trailer`.

### Phase 2: AI Composition

4. **TrailerComposer** takes scored segments and assembles a trailer.
   - File: `web/src/lib/trailer/trailerComposer.ts`
   - AI selects top N segments by score + diversity (no duplicate tags).
   - Generates title cards as canvas-rendered frames (game title, "Made with SpawnForge").
   - Applies crossfade transitions between segments.
   - Selects music from the adaptive music system or a royalty-free library.

5. **VideoEncoder** outputs final MP4 via WebCodecs API.
   - File: `web/src/lib/trailer/videoEncoder.ts`
   - Fallback: FFmpeg.wasm for browsers without WebCodecs.
   - Target: 1080p, 30fps, H.264, < 50MB.

### Phase 3: AI Narration & Polish

6. AI generates voiceover script from game metadata + highlights.
7. Text-to-speech via provider API (reuses existing AI provider chain).
8. Auto-captions overlay.

### Rust Changes

None. Recording uses the HTML canvas element directly via `MediaRecorder`.

### Web Changes

| File | Change |
|------|--------|
| `web/src/lib/trailer/canvasRecorder.ts` | New: MediaRecorder wrapper |
| `web/src/lib/trailer/highlightScorer.ts` | New: Event-based scoring |
| `web/src/lib/trailer/trailerComposer.ts` | New: AI segment selection + assembly |
| `web/src/lib/trailer/videoEncoder.ts` | New: WebCodecs / FFmpeg.wasm output |
| `web/src/lib/chat/handlers/trailerHandlers.ts` | New: MCP handlers |
| `web/src/components/editor/TrailerPanel.tsx` | New: UI for recording + preview |
| `web/src/stores/slices/trailerSlice.ts` | New: recording state, segments, progress |

### MCP Commands (Phase 1)

| Command | Description |
|---------|-------------|
| `start_trailer_recording` | Begin capturing gameplay to segments |
| `stop_trailer_recording` | Stop capture, return segment count |
| `get_trailer_highlights` | Return scored segments ranked by interest |
| `generate_trailer` | AI compose trailer from highlights (Phase 2) |

## Constraints

- **WebCodecs availability**: Chrome 94+, Edge 94+, Safari 16.4+. FFmpeg.wasm fallback for Firefox.
- **Memory**: IndexedDB storage avoids holding video in RAM. Cap at 5 minutes of raw footage.
- **Frame budget**: `MediaRecorder` runs on a separate thread -- zero impact on game frame time.
- **No server-side processing**: All composition happens client-side.

## Acceptance Criteria

- Given a game in play mode, When the user clicks "Record Trailer", Then canvas frames are captured as WebM chunks stored in IndexedDB.
- Given recorded footage with gameplay events, When highlight scoring runs, Then segments with entity spawns/deaths/collectibles score higher than idle segments.
- Given scored highlights, When "Generate Trailer" is clicked, Then a 30-60s MP4 is produced with title cards, transitions, and background music.
- Given no WebCodecs support, When export runs, Then FFmpeg.wasm fallback produces equivalent output.

## Phase 1 Subtasks

1. Implement `CanvasRecorder` with `MediaRecorder` + IndexedDB chunk storage
2. Implement `HighlightScorer` subscribing to engine events during play mode
3. Create `trailerSlice.ts` with recording state management
4. Create `TrailerPanel.tsx` with record/stop/preview controls
5. Add MCP handlers: `start_trailer_recording`, `stop_trailer_recording`, `get_trailer_highlights`
6. Add unit tests for `CanvasRecorder` and `HighlightScorer`
7. Register panel in `panelRegistry.ts` and wire to `WorkspaceProvider`
