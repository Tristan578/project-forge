# Advanced Audio Phase 20 Completion

## Overview

Complete the three remaining stub features in SpawnForge's advanced audio system:
1. Adaptive Music Snapshots (save/load bus states with crossfade)
2. Enhanced Spatial Audio Occlusion (distance-based occlusion with reverb)
3. Loop Point Detection (zero-crossing analysis for seamless loops)

## 1. Adaptive Music Snapshots

### Types

```typescript
interface AudioSnapshot {
  name: string;
  busStates: Record<string, { volume: number; muted: boolean }>;
  crossfadeDurationMs: number;
}
```

### Store Changes (audioSlice.ts)

- Add `audioSnapshots: Record<string, AudioSnapshot>` state
- Add `saveSnapshot(name: string)` — capture current bus states into snapshot
- Add `loadSnapshot(name: string, crossfadeDurationMs?: number)` — crossfade to saved state
- Add `deleteSnapshot(name: string)` — remove a snapshot
- Add `listSnapshots()` — return snapshot names

### AudioManager Changes

- Add `saveSnapshot(name: string): AudioSnapshot` — read current bus volumes/mutes
- Add `loadSnapshot(name: string, durationMs?: number): boolean` — crossfade to saved state, respects active solo rules
- Store snapshots in-memory (Map), not localStorage

### Script API (scriptWorker.ts)

- `forge.audio.saveSnapshot(name: string)` — push `audio_save_snapshot` command
- `forge.audio.loadSnapshot(name: string, durationMs?: number)` — push `audio_load_snapshot` command

## 2. Enhanced Spatial Audio Occlusion

### Current State

The audioManager already has a working occlusion system:
- `setOcclusion(entityId, enabled)` creates lowpass filter
- `updateOcclusionState(entityId, occluded)` ramps filter frequency (500 Hz occluded, 5000 Hz clear)
- `getOccludableEntities()` returns active spatial sources with occlusion
- `reconnectInstance()` inserts/removes filter from signal chain

### Enhancement: Distance-Based Occlusion Amount

Instead of binary occluded/unoccluded, add graduated occlusion based on distance:
- `updateOcclusionAmount(entityId: string, amount: number)` — 0.0 = clear, 1.0 = fully occluded
- Filter frequency: exponential interpolation between 5000 Hz (clear) and 200 Hz (fully occluded)
- Q adjustment: Q increases with occlusion (1.0 to 4.0) for more resonant muffling

### AudioManager Changes

- Add `updateOcclusionAmount(entityId: string, amount: number)` method

### Not Implemented (Follow-Up)

- Reverb-based occlusion (ConvolverNode wet/dry mix for "through-wall" effect) is deferred to a follow-up ticket. The current implementation uses lowpass filter + Q modulation only, which provides realistic distance-based muffling without the complexity of impulse response convolution.

## 3. Loop Point Detection

### Algorithm

Analyze an AudioBuffer to find optimal loop points:
1. Find zero-crossings in the waveform
2. Estimate tempo from autocorrelation (optional, best-effort)
3. Score candidate loop points by proximity to beat boundaries and waveform similarity
4. Return top N candidates sorted by quality

### Types

```typescript
interface LoopPoint {
  startSample: number;
  endSample: number;
  startTime: number;
  endTime: number;
  score: number; // 0-1, higher = better
}
```

### AudioManager Changes

- Add `detectLoopPoints(assetId: string, options?: { maxResults?: number; minLoopDuration?: number }): LoopPoint[]`
- Pure analysis, no side effects on playback

### Script API

- `forge.audio.detectLoopPoints(assetId: string)` — queues `audio_detect_loop_points` command to main thread. Returns `[]` in the worker (fire-and-forget); results are computed in the main thread's audioManager. A follow-up ticket is needed to wire results back to the worker via a response message protocol.

## Test Plan (20+ tests)

### Snapshot Tests (8)
1. saveSnapshot captures current bus states
2. loadSnapshot applies bus volumes with ramp
3. loadSnapshot with crossfade duration
4. loadSnapshot for non-existent snapshot returns null
5. deleteSnapshot removes snapshot
6. Multiple snapshots can coexist
7. Snapshot preserves mute states
8. Store integration: saveSnapshot/loadSnapshot actions

### Occlusion Enhancement Tests (6)
9. updateOcclusionAmount at 0 sets frequency to 5000
10. updateOcclusionAmount at 1 sets frequency to 200
11. updateOcclusionAmount at 0.5 sets intermediate frequency
12. Occlusion disabled entity ignores amount updates
13. Q value scales with occlusion amount
14. ~~Reverb wet amount scales with occlusion~~ (deferred — reverb occlusion not implemented in this PR)

### Loop Detection Tests (8)
15. detectLoopPoints returns empty for unknown asset
16. detectLoopPoints finds zero crossings
17. Loop points have valid time ranges
18. minLoopDuration filters short loops
19. Results sorted by score (highest first)
20. maxResults limits output count
21. Silent buffer returns full-length loop
22. ~~Single-sample zero crossing detected correctly~~ (edge case not separately tested — covered by general zero-crossing tests)

## Files Modified

- `web/src/lib/audio/audioManager.ts` — snapshot, occlusion enhancement, loop detection
- `web/src/stores/slices/audioSlice.ts` — snapshot state/actions
- `web/src/lib/scripting/scriptWorker.ts` — forge.audio.saveSnapshot/loadSnapshot/detectLoopPoints
- `web/src/lib/audio/audioManager.snapshots.test.ts` — new test file
- `web/src/lib/audio/audioManager.loopDetection.test.ts` — new test file
