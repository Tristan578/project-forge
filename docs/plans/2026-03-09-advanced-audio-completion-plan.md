# Advanced Audio Completion (Phase 20) -- Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Complete Phase 20 by fixing the three partially-implemented audio features: adaptive music snapshots, zone-based audio occlusion, and horizontal re-sequencing. Merge the disconnected `AdaptiveMusicManager` into `AudioManager`, add proper Zustand state, fix broken crossfade timing, add new script API methods, and wire up MCP commands. Target: 40+ new tests.

**Architecture:** All audio execution is JS-side (Web Audio API). Rust stores metadata only. New features add state to `AudioManager` singleton + `audioSlice` Zustand store. Scene persistence via opaque JSON in `.forge` files.

**Design Doc:** `docs/plans/2026-03-09-advanced-audio-completion-design.md`

---

### Task 1: Fix AudioSnapshot Data Structure and Zustand State

**Files:**
- Edit: `web/src/stores/slices/audioSlice.ts`
- Edit: `web/src/stores/slices/types.ts`
- Create: `web/src/stores/slices/__tests__/audioSnapshotSlice.test.ts`

**Step 1: Write the failing tests**

```typescript
// web/src/stores/slices/__tests__/audioSnapshotSlice.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createSliceStore } from '@/test/utils/componentTestUtils';

describe('audioSlice - snapshots', () => {
  // Test: initial state has empty snapshots
  it('should have empty audioSnapshots initially', () => {
    const store = createSliceStore();
    expect(store.getState().audioSnapshots).toEqual({});
    expect(store.getState().activeSnapshotName).toBeNull();
  });

  // Test: createAudioSnapshot captures bus state
  it('should create a snapshot with current bus volumes', () => {
    const store = createSliceStore();
    store.getState().createAudioSnapshot('combat');
    const snapshots = store.getState().audioSnapshots;
    expect(snapshots['combat']).toBeDefined();
    expect(snapshots['combat'].buses.length).toBeGreaterThan(0);
  });

  // Test: deleteAudioSnapshot removes it
  it('should delete a snapshot by name', () => {
    const store = createSliceStore();
    store.getState().createAudioSnapshot('combat');
    store.getState().deleteAudioSnapshot('combat');
    expect(store.getState().audioSnapshots['combat']).toBeUndefined();
  });

  // Test: applyAudioSnapshot sets activeSnapshotName
  it('should set activeSnapshotName when applying', () => {
    const store = createSliceStore();
    store.getState().createAudioSnapshot('explore');
    store.getState().applyAudioSnapshot('explore');
    expect(store.getState().activeSnapshotName).toBe('explore');
  });

  // Test: listAudioSnapshots returns all names
  it('should list all snapshot names', () => {
    const store = createSliceStore();
    store.getState().createAudioSnapshot('a');
    store.getState().createAudioSnapshot('b');
    expect(store.getState().listAudioSnapshots()).toEqual(['a', 'b']);
  });
});
```

**Step 2: Add types**

In `web/src/stores/slices/types.ts`, add:

```typescript
export interface AudioSnapshot {
  name: string;
  createdAt: number;
  buses: Array<{
    name: string;
    volume: number;
    muted: boolean;
    effects: AudioEffectDef[];
  }>;
  adaptiveMusic: {
    intensity: number;
    activeSegment: string | null;
  } | null;
  duckingRules: Array<{
    triggerBus: string;
    targetBus: string;
    duckLevel: number;
    attackMs: number;
    releaseMs: number;
  }>;
}
```

**Step 3: Implement in audioSlice.ts**

Add to `AudioSlice` interface:
- `audioSnapshots: Record<string, AudioSnapshot>`
- `activeSnapshotName: string | null`
- `createAudioSnapshot: (name: string) => void`
- `applyAudioSnapshot: (name: string, crossfadeDurationMs?: number) => void`
- `deleteAudioSnapshot: (name: string) => void`
- `listAudioSnapshots: () => string[]`

The `createAudioSnapshot` action reads current `audioBuses` state and `adaptiveMusicIntensity`/`currentMusicSegment` to build the snapshot. The `applyAudioSnapshot` action calls `audioManager.applySnapshot()` (added in Task 2).

**Commit after this task.**

---

### Task 2: Fix AudioManager Snapshot Implementation

**Files:**
- Edit: `web/src/lib/audio/audioManager.ts`
- Create: `web/src/lib/audio/__tests__/audioSnapshots.test.ts`

**Step 1: Write the failing tests**

```typescript
// web/src/lib/audio/__tests__/audioSnapshots.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock AudioContext, GainNode, etc.
// Test: applySnapshot ramps bus volumes with linearRampToValueAtTime
// Test: applySnapshot with 0ms duration applies immediately (setValueAtTime)
// Test: applySnapshot handles missing bus gracefully
// Test: captureSnapshot returns current bus state
// Test: crossfade uses correct timing (not seconds-as-milliseconds bug)
```

**Step 2: Implement on AudioManager**

Add methods:
- `captureSnapshot(): AudioSnapshotData` -- reads all bus volumes, mute state, effects
- `applySnapshot(snapshot: AudioSnapshotData, crossfadeDurationMs: number): void` -- uses `linearRampToValueAtTime` for smooth bus volume transitions
- Fix the existing crossfade bug: `setTimeout` callback was passing `durationSec` (seconds) to `setTimeout` which expects milliseconds

Key fix in the crossfade:
```typescript
// BEFORE (broken):
setTimeout(() => { ... }, durationSec);  // durationSec=1 means 1ms, not 1s

// AFTER (fixed):
// Use Web Audio API scheduling instead of setTimeout:
bus.gainNode.gain.linearRampToValueAtTime(targetVolume, ctx.currentTime + durationSec);
```

**Commit after this task.**

---

### Task 3: Merge AdaptiveMusicManager Segments into AudioManager

**Files:**
- Edit: `web/src/lib/audio/audioManager.ts`
- Edit: `web/src/lib/audio/adaptiveMusic.ts` (deprecate/remove)
- Create: `web/src/lib/audio/__tests__/audioSegments.test.ts`

**Step 1: Write the failing tests**

```typescript
// web/src/lib/audio/__tests__/audioSegments.test.ts
describe('AudioManager - horizontal re-sequencing', () => {
  // Test: setMusicSegments stores segment definitions on a track
  // Test: transitionToSegment with quantize='immediate' seeks all stems
  // Test: transitionToSegment with quantize='beat' calculates next beat time
  // Test: transitionToSegment with quantize='bar' calculates next bar time
  // Test: getCurrentSegment returns active segment name
  // Test: setBPM updates beats-per-minute for quantization
  // Test: unknown segment name returns error/warning
  // Test: transition while not playing is no-op
});
```

**Step 2: Add segment support to AudioManager**

Add to `AudioManager`:
- `private trackSegments: Map<string, MusicSegment[]>` -- per-track segment definitions
- `private trackBPM: Map<string, number>` -- per-track BPM
- `private trackTimeSignature: Map<string, [number, number]>` -- per-track time sig
- `private trackCurrentSegment: Map<string, string>` -- per-track active segment

New methods:
```typescript
setMusicSegments(trackId: string, segments: MusicSegment[]): void;
transitionToSegment(trackId: string, segmentName: string, options?: {
  quantize?: 'beat' | 'bar' | 'immediate';
  crossfadeMs?: number;
}): void;
getCurrentSegment(trackId: string): string | null;
setBPM(trackId: string, bpm: number): void;
setTimeSignature(trackId: string, numerator: number, denominator: number): void;
```

**Step 3: Remove/deprecate standalone AdaptiveMusicManager**

Mark `adaptiveMusic.ts` as deprecated. The `AdaptiveMusicManager` class is no longer needed since `AudioManager` handles both vertical (stems) and horizontal (segments) axes. Keep the file but add a deprecation notice and re-export from AudioManager for backward compatibility.

**Commit after this task.**

---

### Task 4: Zone-Based Occlusion Manager

**Files:**
- Create: `web/src/lib/audio/occlusionManager.ts`
- Create: `web/src/lib/audio/__tests__/occlusionManager.test.ts`

**Step 1: Write the failing tests**

```typescript
// web/src/lib/audio/__tests__/occlusionManager.test.ts
describe('OcclusionManager', () => {
  // Test: addZone stores zone data
  // Test: removeZone deletes zone
  // Test: updateZone modifies zone properties
  // Test: lineIntersectsAABB returns true for intersecting line
  // Test: lineIntersectsAABB returns false for non-intersecting line
  // Test: lineIntersectsAABB edge case: line starts inside box
  // Test: computeOcclusion returns 0 when no zones between source and listener
  // Test: computeOcclusion returns zone.factor when one zone blocks
  // Test: computeOcclusion accumulates factors from multiple zones (clamped to 1)
  // Test: tick calls audioManager.updateOcclusionLevel for each occludable entity
  // Test: start/stop manage interval lifecycle
  // Test: stopped manager does not tick
});
```

**Step 2: Implement OcclusionManager**

```typescript
// web/src/lib/audio/occlusionManager.ts
export interface OcclusionZone {
  zoneId: string;
  position: [number, number, number];
  halfExtents: [number, number, number];
  occlusionFactor: number;
  occlusionFrequency: number;
}

export class OcclusionManager {
  private zones: Map<string, OcclusionZone> = new Map();
  private checkIntervalMs = 100;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  constructor(private audioManager: AudioManagerInterface) {}

  addZone(zone: OcclusionZone): void { ... }
  removeZone(zoneId: string): void { ... }
  updateZone(zoneId: string, update: Partial<OcclusionZone>): void { ... }
  getZone(zoneId: string): OcclusionZone | undefined { ... }
  getAllZones(): OcclusionZone[] { ... }

  start(): void { this.intervalHandle = setInterval(() => this.tick(), this.checkIntervalMs); }
  stop(): void { if (this.intervalHandle) { clearInterval(this.intervalHandle); this.intervalHandle = null; } }

  tick(): void {
    const listenerPos = this.audioManager.getListenerPosition();
    if (!listenerPos) return;

    for (const entityId of this.audioManager.getOccludableEntities()) {
      const sourcePos = this.audioManager.getSourcePosition(entityId);
      if (!sourcePos) continue;

      let totalOcclusion = 0;
      for (const zone of this.zones.values()) {
        if (this.lineIntersectsAABB(listenerPos, sourcePos, zone)) {
          totalOcclusion += zone.occlusionFactor;
        }
      }
      totalOcclusion = Math.min(totalOcclusion, 1);
      this.audioManager.updateOcclusionLevel(entityId, totalOcclusion);
    }
  }

  // Slab method for line-AABB intersection
  lineIntersectsAABB(
    p0: [number, number, number],
    p1: [number, number, number],
    zone: OcclusionZone
  ): boolean { ... }
}
```

**Step 3: Update AudioManager occlusion API**

Replace `updateOcclusionState(entityId, occluded: boolean)` with `updateOcclusionLevel(entityId, factor: number)`:

```typescript
updateOcclusionLevel(entityId: string, factor: number): void {
  const filter = this.occlusionFilters.get(entityId);
  if (!filter || !this.ctx) return;

  const now = this.ctx.currentTime;
  // Interpolate between 20000 Hz (clear) and 500 Hz (fully occluded)
  const targetFreq = 20000 * Math.pow(500 / 20000, factor);
  filter.frequency.cancelScheduledValues(now);
  filter.frequency.setValueAtTime(filter.frequency.value, now);
  filter.frequency.linearRampToValueAtTime(targetFreq, now + 0.05);
}
```

**Commit after this task.**

---

### Task 5: Wire OcclusionManager to Play Mode Lifecycle

**Files:**
- Edit: `web/src/hooks/events/audioEvents.ts`
- Edit: `web/src/lib/audio/audioManager.ts` (export occlusionManager instance)
- Create: `web/src/lib/audio/__tests__/occlusionIntegration.test.ts`

**Step 1: Write the failing tests**

```typescript
describe('Occlusion play mode integration', () => {
  // Test: occlusionManager.start() called on MODE_CHANGED to Play
  // Test: occlusionManager.stop() called on MODE_CHANGED to Edit
  // Test: occlusionManager.stop() called on MODE_CHANGED to Paused
});
```

**Step 2: Integrate**

In `audioEvents.ts`, handle `MODE_CHANGED` event to start/stop the occlusion manager:

```typescript
case 'MODE_CHANGED': {
  const mode = data.mode as string;
  if (mode === 'Play') {
    occlusionManager.start();
  } else {
    occlusionManager.stop();
  }
  return true;
}
```

Export `occlusionManager` singleton from `audioManager.ts`:
```typescript
export const occlusionManager = new OcclusionManager(audioManager);
```

**Commit after this task.**

---

### Task 6: Fix MCP Chat Handlers

**Files:**
- Edit: `web/src/lib/chat/handlers/audioHandlers.ts`
- Edit: `web/src/lib/chat/handlers/__tests__/audioPhysicsGameHandlers.test.ts`

**Step 1: Update existing tests and add new ones**

Update tests for:
- `transition_music_segment`: verify it calls `audioManager.transitionToSegment()` instead of just setting Zustand state
- `create_audio_snapshot`: verify it uses Zustand `createAudioSnapshot()` instead of localStorage
- `apply_audio_snapshot`: verify it uses Zustand `applyAudioSnapshot()` with correct crossfade duration

Add tests for new handlers:
- `set_music_segments`: sets segment definitions on a track
- `set_music_bpm`: sets BPM for quantization
- `add_occlusion_zone`: adds a zone to OcclusionManager
- `remove_occlusion_zone`: removes a zone
- `delete_audio_snapshot`: removes a snapshot from store

**Step 2: Fix existing handlers**

```typescript
// transition_music_segment -- FIXED
transition_music_segment: async (args, ctx) => {
  // ... parse args ...
  const trackId = p.data.trackId ?? 'default';
  audioManager.transitionToSegment(trackId, p.data.segment, {
    quantize: p.data.quantize ?? 'beat',
    crossfadeMs: p.data.crossfadeDurationMs,
  });
  ctx.store.setCurrentMusicSegment(p.data.segment);
  return { success: true, result: `...` };
};

// create_audio_snapshot -- FIXED
create_audio_snapshot: async (args, ctx) => {
  // ... parse args ...
  ctx.store.createAudioSnapshot(p.data.name);
  return { success: true, result: `Created audio snapshot: ${p.data.name}` };
};

// apply_audio_snapshot -- FIXED
apply_audio_snapshot: async (args, ctx) => {
  // ... parse args ...
  ctx.store.applyAudioSnapshot(p.data.name, p.data.crossfadeDurationMs);
  return { success: true, result: `Applied audio snapshot: ${p.data.name}` };
};
```

**Step 3: Add new handlers**

```typescript
set_music_segments: async (args, _ctx) => { /* parse + call audioManager.setMusicSegments() */ };
set_music_bpm: async (args, _ctx) => { /* parse + call audioManager.setBPM() */ };
add_occlusion_zone: async (args, _ctx) => { /* parse + call occlusionManager.addZone() */ };
remove_occlusion_zone: async (args, _ctx) => { /* parse + call occlusionManager.removeZone() */ };
delete_audio_snapshot: async (args, ctx) => { /* parse + call ctx.store.deleteAudioSnapshot() */ };
```

**Commit after this task.**

---

### Task 7: Add MCP Command Definitions

**Files:**
- Edit: `mcp-server/manifest/commands.json`
- Edit: `web/src/data/commands.json` (keep in sync)

**Step 1: Add 5 new command definitions**

```json
{
  "name": "set_music_segments",
  "description": "Define named music segments with start times for horizontal re-sequencing",
  "category": "audio",
  "parameters": {
    "type": "object",
    "properties": {
      "trackId": { "type": "string", "description": "Track ID (default: 'default')" },
      "segments": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "name": { "type": "string" },
            "startTime": { "type": "number" },
            "duration": { "type": "number" }
          },
          "required": ["name", "startTime"]
        }
      }
    },
    "required": ["segments"]
  },
  "tokenCost": 0,
  "requiredScope": "scene:write"
},
{
  "name": "set_music_bpm",
  "description": "Set BPM for beat/bar-quantized music transitions",
  "category": "audio",
  "parameters": {
    "type": "object",
    "properties": {
      "trackId": { "type": "string" },
      "bpm": { "type": "number", "minimum": 20, "maximum": 300 }
    },
    "required": ["bpm"]
  },
  "tokenCost": 0,
  "requiredScope": "scene:write"
},
{
  "name": "add_occlusion_zone",
  "description": "Add an AABB occlusion zone for sound attenuation through walls/geometry",
  "category": "audio",
  "parameters": {
    "type": "object",
    "properties": {
      "zoneId": { "type": "string" },
      "position": { "type": "array", "items": { "type": "number" }, "minItems": 3, "maxItems": 3 },
      "halfExtents": { "type": "array", "items": { "type": "number" }, "minItems": 3, "maxItems": 3 },
      "occlusionFactor": { "type": "number", "minimum": 0, "maximum": 1 },
      "occlusionFrequency": { "type": "number", "minimum": 20, "maximum": 20000 }
    },
    "required": ["zoneId", "position", "halfExtents"]
  },
  "tokenCost": 0,
  "requiredScope": "scene:write"
},
{
  "name": "remove_occlusion_zone",
  "description": "Remove an audio occlusion zone by ID",
  "category": "audio",
  "parameters": {
    "type": "object",
    "properties": {
      "zoneId": { "type": "string" }
    },
    "required": ["zoneId"]
  },
  "tokenCost": 0,
  "requiredScope": "scene:write"
},
{
  "name": "delete_audio_snapshot",
  "description": "Delete a saved audio snapshot by name",
  "category": "audio",
  "parameters": {
    "type": "object",
    "properties": {
      "name": { "type": "string" }
    },
    "required": ["name"]
  },
  "tokenCost": 0,
  "requiredScope": "scene:write"
}
```

**Step 2: Update `transition_music_segment` command**

Add `trackId` and `quantize` parameters to the existing command definition:

```json
{
  "name": "transition_music_segment",
  "description": "Transition to a named music segment with beat/bar-quantized timing (horizontal re-sequencing)",
  "category": "audio",
  "parameters": {
    "type": "object",
    "properties": {
      "trackId": { "type": "string", "description": "Track ID (default: 'default')" },
      "segment": { "type": "string", "description": "Segment name to transition to" },
      "quantize": { "type": "string", "enum": ["beat", "bar", "immediate"], "description": "Quantization mode (default: beat)" },
      "crossfadeDurationMs": { "type": "number", "description": "Crossfade duration in ms" }
    },
    "required": ["segment"]
  },
  "tokenCost": 0,
  "requiredScope": "scene:write"
}
```

**Commit after this task.**

---

### Task 8: Script API Extensions

**Files:**
- Edit: `web/src/lib/scripting/scriptWorker.ts`
- Edit: `web/src/lib/scripting/forgeTypes.ts`
- Create: `web/src/lib/scripting/__tests__/audioScriptApi.test.ts`

**Step 1: Write the failing tests**

```typescript
describe('forge.audio script API extensions', () => {
  // Test: forge.audio.transitionSegment pushes transition_music_segment command
  // Test: forge.audio.getCurrentSegment returns current segment name
  // Test: forge.audio.setBPM pushes set_music_bpm command
  // Test: forge.audio.createSnapshot pushes create_audio_snapshot command
  // Test: forge.audio.applySnapshot pushes apply_audio_snapshot command
  // Test: forge.audio.setOcclusion pushes set_audio_occlusion command
  // Test: forge.audio.addOcclusionZone pushes add_occlusion_zone command
  // Test: forge.audio.removeOcclusionZone pushes remove_occlusion_zone command
});
```

**Step 2: Add to scriptWorker.ts forge.audio object**

```typescript
// In the audio object, after existing methods:
transitionSegment: (segment: string, options?: {
  quantize?: 'beat' | 'bar' | 'immediate'; crossfadeMs?: number;
}) => {
  pendingCommands.push({
    cmd: 'transition_music_segment', segment,
    quantize: options?.quantize, crossfadeDurationMs: options?.crossfadeMs,
  });
},
getCurrentSegment: () => {
  return currentMusicSegment ?? 'intro';
},
setBPM: (bpm: number) => {
  pendingCommands.push({ cmd: 'set_music_bpm', bpm });
},
createSnapshot: (name: string) => {
  pendingCommands.push({ cmd: 'create_audio_snapshot', name });
},
applySnapshot: (name: string, crossfadeMs?: number) => {
  pendingCommands.push({ cmd: 'apply_audio_snapshot', name, crossfadeDurationMs: crossfadeMs });
},
setOcclusion: (entityId: string, enabled: boolean) => {
  pendingCommands.push({ cmd: 'set_audio_occlusion', entityId, enabled });
},
addOcclusionZone: (zoneId: string, position: [number,number,number],
  halfExtents: [number,number,number], factor?: number) => {
  pendingCommands.push({
    cmd: 'add_occlusion_zone', zoneId, position, halfExtents,
    occlusionFactor: factor ?? 1.0,
  });
},
removeOcclusionZone: (zoneId: string) => {
  pendingCommands.push({ cmd: 'remove_occlusion_zone', zoneId });
},
```

**Step 3: Update forgeTypes.ts**

Add type declarations for the new methods in the `forge.audio` namespace.

**Commit after this task.**

---

### Task 9: Scene Persistence for Audio State

**Files:**
- Edit: `engine/src/core/scene_file.rs` (add optional fields)
- Edit: `engine/src/bridge/scene_io.rs` (pass through audio state)
- Edit: `web/src/hooks/events/audioEvents.ts` (handle SCENE_LOADED for audio state)
- Create: `web/src/lib/audio/__tests__/scenePersistence.test.ts`

**Step 1: Write the failing tests**

```typescript
describe('Audio scene persistence', () => {
  // Test: SCENE_LOADED event with audioSnapshots restores snapshot state
  // Test: SCENE_LOADED event with occlusionZones restores zone state
  // Test: SCENE_LOADED event without audio fields does not error
  // Test: scene export includes audioSnapshots from store
});
```

**Step 2: Add fields to SceneData (Rust)**

In `scene_file.rs`, add to `SceneData`:
```rust
#[serde(default, skip_serializing_if = "Option::is_none")]
pub audio_snapshots: Option<serde_json::Value>,
#[serde(default, skip_serializing_if = "Option::is_none")]
pub occlusion_zones: Option<serde_json::Value>,
#[serde(default, skip_serializing_if = "Option::is_none")]
pub adaptive_music_config: Option<serde_json::Value>,
```

**Step 3: Handle in scene load/export events**

On `SCENE_LOADED`, if `audio_snapshots` field exists, hydrate `audioSlice.audioSnapshots`. If `occlusion_zones` exists, hydrate `occlusionManager` zones.

On scene export, include current `audioSnapshots` and `occlusionManager.getAllZones()` in the scene data sent to Rust.

**Commit after this task.**

---

### Task 10: Audio Inspector UI -- Occlusion Toggle

**Files:**
- Edit: `web/src/components/editor/AudioInspector.tsx` (or equivalent)
- Create: `web/src/components/editor/__tests__/audioOcclusionInspector.test.ts`

**Step 1: Write the failing tests**

```typescript
describe('AudioInspector occlusion toggle', () => {
  // Test: renders occlusion checkbox for spatial audio entities
  // Test: checking occlusion calls audioManager.setOcclusion(entityId, true)
  // Test: unchecking occlusion calls audioManager.setOcclusion(entityId, false)
  // Test: occlusion checkbox hidden when audio is not spatial
});
```

**Step 2: Add occlusion toggle**

In the AudioInspector component, add a checkbox below the spatial audio settings:

```tsx
{audio.spatial && (
  <label className="flex items-center gap-2">
    <input
      type="checkbox"
      checked={occlusionEnabled}
      onChange={(e) => audioManager.setOcclusion(entityId, e.target.checked)}
    />
    <span className="text-sm">Audio Occlusion</span>
  </label>
)}
```

**Commit after this task.**

---

### Task 11: Integration Tests and Validation

**Files:**
- Create: `web/src/lib/audio/__tests__/advancedAudioIntegration.test.ts`

**Step 1: Write integration tests**

```typescript
describe('Advanced Audio Integration', () => {
  // Test: full workflow: set adaptive music -> set segments -> set intensity -> transition segment
  // Test: full workflow: create snapshot -> modify buses -> apply snapshot (restores)
  // Test: full workflow: add occlusion zone -> enable occlusion on entity -> tick -> filter applied
  // Test: snapshot + segment state round-trips through scene save/load
  // Test: multiple tracks with independent segments and intensities
});
```

**Step 2: Run full validation suite**

```bash
cd web && npx eslint --max-warnings 0 .
cd web && npx tsc --noEmit
cd web && npx vitest run
cd mcp-server && npx vitest run
```

**Commit after this task.**

---

## Summary of Changes

| Area | Files Created | Files Edited | Tests Added |
|------|--------------|-------------|-------------|
| Zustand snapshot state | 1 test file | audioSlice.ts, types.ts | ~5 |
| AudioManager snapshots | 1 test file | audioManager.ts | ~5 |
| Segment re-sequencing | 1 test file | audioManager.ts, adaptiveMusic.ts | ~8 |
| OcclusionManager | 2 files (impl + test) | audioManager.ts | ~12 |
| Play mode integration | 1 test file | audioEvents.ts | ~3 |
| MCP handlers | 0 | audioHandlers.ts, test file | ~10 |
| MCP commands | 0 | commands.json (x2) | 0 |
| Script API | 1 test file | scriptWorker.ts, forgeTypes.ts | ~8 |
| Scene persistence | 1 test file | scene_file.rs, scene_io.rs, audioEvents.ts | ~4 |
| Inspector UI | 1 test file | AudioInspector.tsx | ~4 |
| Integration | 1 test file | - | ~5 |
| **Total** | **~8 new files** | **~12 edited files** | **~64 tests** |

## New MCP Commands (net new: 5)

1. `set_music_segments` -- Define horizontal segments for a track
2. `set_music_bpm` -- Set BPM for quantized transitions
3. `add_occlusion_zone` -- Add AABB occlusion zone
4. `remove_occlusion_zone` -- Remove occlusion zone
5. `delete_audio_snapshot` -- Delete saved snapshot

## Fixed MCP Commands (3)

1. `transition_music_segment` -- Now actually calls AudioManager
2. `create_audio_snapshot` -- Now uses Zustand, captures full state
3. `apply_audio_snapshot` -- Now uses Web Audio scheduling, not broken setTimeout
