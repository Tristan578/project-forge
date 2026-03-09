# Advanced Audio Completion (Phase 20) -- Design Document

**Date:** 2026-03-09
**Status:** Draft
**Phase:** 20 (Advanced Audio -- partial completion)

---

## 1. Problem Statement

Phase 20 was marked PARTIAL because three advanced audio features lack proper integration despite having foundational code:

1. **Adaptive Music Snapshots** -- The snapshot system uses raw `localStorage` with a broken crossfade (`setTimeout` passes seconds as milliseconds), captures only bus volumes (not stem intensity, ducking rules, or effects parameters), and has no Zustand state management for snapshot names/listing.

2. **Audio Occlusion** -- The low-pass filter chain is wired correctly in `AudioManager`, but nothing drives `updateOcclusionState()` during play mode. `getOccludableEntities()` exists but no play-tick system polls for occlusion. The design doc calls for "zone-based, not per-ray" but the current approach requires per-entity raycasts from the physics system -- which is never invoked.

3. **Horizontal Re-sequencing** -- A standalone `AdaptiveMusicManager` class implements beat-quantized segment transitions, but the MCP `transition_music_segment` handler only updates Zustand state without calling `AdaptiveMusicManager.transitionToSegment()`. The two adaptive music systems (`AdaptiveMusicManager` in `adaptiveMusic.ts` and stem-based `setAdaptiveMusic()` in `audioManager.ts`) are disconnected.

---

## 2. Architecture Overview

### 2.1. Existing Audio Architecture

```
Rust ECS (metadata only)              JS (Web Audio API execution)
-------------------------------       ----------------------------------------
AudioData component                   audioManager singleton
  - assetId, volume, pitch              - AudioContext, instances, buffers
  - spatial, bus, autoplay               - bus routing (GainNode graph)
AudioBusConfig resource                  - spatial audio (PannerNode)
ReverbZoneData component                 - reverb (ConvolverNode)
                                         - occlusion (BiquadFilterNode)
                                         - adaptive music (stem layers)
                                         - AdaptiveMusicManager (segments)

JSON commands (Rust -> JS):
  AUDIO_CHANGED, AUDIO_PLAYBACK, AUDIO_BUSES_CHANGED, REVERB_ZONE_CHANGED

JSON commands (JS -> Rust):
  set_audio, play_audio, stop_audio, update_audio_bus, etc.
```

### 2.2. Key Constraint: Audio Is JS-Side Only

Rust stores metadata (`AudioData`, `AudioBusConfig`). All actual audio processing happens in the Web Audio API graph managed by `AudioManager`. This means:

- Occlusion zone checking must happen in JS (using entity transform data from Zustand store)
- Adaptive music state lives in JS (`AudioManager.adaptiveTracks`)
- Snapshots are JS-side state capture/restore operations
- The Rust engine does NOT need new ECS components for these features

### 2.3. Proposed Architecture Changes

```
                   +-----------------------+
                   |   AudioSnapshotStore  |  (new Zustand state)
                   |   - snapshots: Map     |
                   |   - activeSnapshot     |
                   +-----------+-----------+
                               |
+------------------+    +------+------+    +-------------------+
| AdaptiveMusicMgr |    | AudioManager|    | OcclusionManager  |
| (merged into AM) |    | (singleton) |    | (new, zone-based) |
|                  |    |             |    |                   |
| - segments       |    | - stems     |    | - zones: Map      |
| - BPM/quantize   |    | - filters   |    | - checkInterval   |
| - seekToTime     |    | - snapshots |    | - AABB overlap    |
+------------------+    +------+------+    +-------------------+
                               |
                    Web Audio API Graph
```

---

## 3. Feature Design: Adaptive Music Snapshots

### 3.1. What Is an Audio Snapshot?

An audio snapshot captures the complete mixer state at a point in time, enabling FMOD-style "game state to audio state" transitions. Example: "exploration" snapshot has low music intensity, full ambient volume; "combat" snapshot has high intensity, ducked ambient, reverb on SFX bus.

### 3.2. Data Structure

```typescript
interface AudioSnapshot {
  name: string;
  createdAt: number;

  // Bus state
  buses: Array<{
    name: string;
    volume: number;
    muted: boolean;
    effects: AudioEffectDef[];
  }>;

  // Adaptive music state
  adaptiveMusic: {
    intensity: number;
    activeSegment: string | null;
  } | null;

  // Ducking overrides
  duckingRules: Array<{
    triggerBus: string;
    targetBus: string;
    duckLevel: number;
    attackMs: number;
    releaseMs: number;
  }>;
}
```

### 3.3. Crossfade Implementation

The current implementation has a bug: `setTimeout(() => { ... }, durationSec)` passes seconds to a millisecond API. The fix uses Web Audio API parameter scheduling for true smooth crossfade:

```
Current bus volumes ----[linearRampToValueAtTime]----> Snapshot bus volumes
                        ^                          ^
                        now                        now + durationSec
```

Each bus `gainNode.gain` gets a `linearRampToValueAtTime()` call, creating a hardware-accurate crossfade. Adaptive music intensity also ramps via `setMusicIntensity()` with a matching ramp duration.

### 3.4. Storage

Snapshots stored in Zustand `audioSlice` (not localStorage). Persisted to `.forge` scene file alongside bus config. This means snapshots survive page reload and are part of the project.

### 3.5. Zustand State Additions

```typescript
// Added to AudioSlice
audioSnapshots: Record<string, AudioSnapshot>;
activeSnapshotName: string | null;
createAudioSnapshot: (name: string) => void;
applyAudioSnapshot: (name: string, crossfadeDurationMs?: number) => void;
deleteAudioSnapshot: (name: string) => void;
listAudioSnapshots: () => string[];
```

---

## 4. Feature Design: Audio Occlusion (Zone-Based)

### 4.1. Why Zone-Based Instead of Raycast-Based?

Per-entity raycasting from the audio thread is impractical because:
- Physics raycasts go through Rust (`handle_command` -> rapier), creating cross-thread latency
- Polling raycasts every frame for N audio sources is O(N) command round-trips
- The Web Audio API runs on a separate thread from the main thread

Zone-based occlusion is simpler and more predictable: define "occlusion zones" (walls, rooms) as axis-aligned boxes. If a zone AABB sits between listener and source, the source is occluded. This is how many shipped games handle it (Unreal's Sound Attenuation volumes).

### 4.2. Occlusion Zone Concept

An occlusion zone is a lightweight entity with:
- A Transform (position + scale defines the AABB)
- An `occlusionFactor` (0.0 = transparent to sound, 1.0 = full occlusion)
- An `occlusionFrequency` (target low-pass cutoff when fully occluded, default 500 Hz)

These are NOT ECS components on the Rust side. They are purely JS-side state managed by the `OcclusionManager`, configured via commands. This avoids adding new Rust components for a feature that is entirely JS-executed.

### 4.3. Occlusion Check Algorithm

Every N milliseconds (default 100ms, configurable):

```
for each playing spatial audio entity with occlusion enabled:
  sourcePos = pannerNode position
  listenerPos = AudioContext.listener position

  for each occlusion zone:
    if zone AABB intersects line segment (listenerPos, sourcePos):
      totalOcclusion += zone.occlusionFactor

  totalOcclusion = clamp(totalOcclusion, 0, 1)
  targetFrequency = lerp(20000, zone.occlusionFrequency, totalOcclusion)

  ramp lowpass filter to targetFrequency over 50ms
```

The line-segment-vs-AABB test is a standard slab method, runs in O(zones * sources) which is fine for typical game scenes (< 50 zones, < 20 active sources).

### 4.4. Integration with Existing Filter Chain

The `AudioManager` already inserts `BiquadFilterNode` into the signal chain:

```
source -> gainNode -> [pannerNode] -> [occlusionFilter] -> busGainNode
```

The `OcclusionManager` calls `audioManager.updateOcclusionState()` but with a continuous frequency value instead of a boolean:

```typescript
// Current (binary):
updateOcclusionState(entityId: string, occluded: boolean): void

// Proposed (continuous):
updateOcclusionLevel(entityId: string, occlusionFactor: number): void
```

This allows partial occlusion when a source is near the edge of a zone or blocked by multiple thin walls.

### 4.5. Data Structures

```typescript
interface OcclusionZone {
  zoneId: string;
  position: [number, number, number];
  halfExtents: [number, number, number]; // AABB half-sizes
  occlusionFactor: number;  // 0-1
  occlusionFrequency: number; // Hz, target cutoff when fully occluded
}

class OcclusionManager {
  private zones: Map<string, OcclusionZone>;
  private checkIntervalMs: number;
  private intervalHandle: number | null;
  private audioManager: AudioManager;

  addZone(zone: OcclusionZone): void;
  removeZone(zoneId: string): void;
  updateZone(zoneId: string, update: Partial<OcclusionZone>): void;

  start(): void;   // Begin polling
  stop(): void;    // Stop polling (on pause/edit mode)
  tick(): void;    // Single check cycle
}
```

### 4.6. Play Mode Integration

- `OcclusionManager.start()` called when entering Play mode
- `OcclusionManager.stop()` called when entering Edit/Pause mode
- Listener position obtained from `audioManager.getListenerPosition()`
- Source positions obtained from `audioManager.getSourcePosition(entityId)`
- Zone positions updated from Zustand scene graph transforms (entities can move at runtime)

---

## 5. Feature Design: Horizontal Re-sequencing

### 5.1. What Is Horizontal Re-sequencing?

Music is composed of horizontal segments (intro, verse, chorus, bridge, outro). Re-sequencing means jumping between segments in response to game events, with transitions quantized to musical bar boundaries to maintain rhythmic coherence.

Example: Player enters combat zone -> music transitions from "exploration" segment to "combat" segment at the next bar line.

### 5.2. Current State

Two disconnected systems exist:
1. `AdaptiveMusicManager` (standalone class) -- has `setSegments()`, `transitionToSegment()`, `seekToTime()` with beat quantization
2. `AudioManager.setAdaptiveMusic()` -- stem-based intensity system with no segment awareness

The problem: the MCP handler `transition_music_segment` only updates `store.currentMusicSegment` in Zustand without actually triggering audio transitions.

### 5.3. Proposed Unification

Merge `AdaptiveMusicManager` segment logic INTO `AudioManager` so that one system handles both:
- **Vertical layering** (stem intensity: calm -> intense)
- **Horizontal transitions** (segment switching: intro -> combat -> boss)

These are orthogonal axes that compose naturally:
- Segment defines WHICH audio content plays
- Intensity defines HOW MUCH of that content is heard

### 5.4. Segment Data Structure

```typescript
interface MusicSegment {
  name: string;
  /** Start offset in seconds within the stem buffers */
  startTime: number;
  /** Duration in seconds (0 = play to end/loop) */
  duration: number;
  /** Optional: different stem set for this segment */
  stemOverrides?: Record<string, string>; // stemName -> assetId
}

interface AdaptiveMusicConfig {
  trackId: string;
  stems: Array<StemConfig>;
  segments: MusicSegment[];
  bpm: number;
  timeSignature: [number, number]; // e.g., [4, 4]
  bus: string;
}
```

### 5.5. Transition Types

1. **Beat-quantized** (default): Wait for next beat boundary, then seek all stems to the new segment's startTime. Maintains rhythmic continuity.

2. **Bar-quantized**: Wait for next bar boundary (beat multiple of time signature numerator). More musical for most transitions.

3. **Immediate**: Seek immediately with a short crossfade (50ms) to avoid clicks.

4. **Crossfade**: Overlap old and new segment with a configurable crossfade duration. Creates two sets of source nodes temporarily.

### 5.6. Implementation in AudioManager

```typescript
// New methods on AudioManager:
setMusicSegments(trackId: string, segments: MusicSegment[]): void;
transitionToSegment(trackId: string, segmentName: string, options?: {
  quantize?: 'beat' | 'bar' | 'immediate';
  crossfadeMs?: number;
}): void;
getCurrentSegment(trackId: string): string | null;
setBPM(trackId: string, bpm: number): void;
setTimeSignature(trackId: string, numerator: number, denominator: number): void;
```

The internal implementation reuses the `seekToTime` logic from `AdaptiveMusicManager` but applied to the stem layer system:

```
1. Calculate next quantization point (beat or bar boundary)
2. Schedule: at quantization point, stop current sources
3. Create new sources for all active stems starting at segment.startTime
4. If crossfade: overlap old/new sources with opposing volume ramps
5. Update track.currentSegment
```

---

## 6. Script API Extensions

### 6.1. New `forge.audio.*` Methods

```typescript
// Adaptive music (extends existing)
forge.audio.setMusicIntensity(level: number): void;                    // EXISTS
forge.audio.loadStems(stems: Record<string, string>): void;           // EXISTS

// Horizontal re-sequencing (NEW)
forge.audio.transitionSegment(segment: string, options?: {
  quantize?: 'beat' | 'bar' | 'immediate';
  crossfadeMs?: number;
}): void;
forge.audio.getCurrentSegment(): string;
forge.audio.setBPM(bpm: number): void;

// Snapshots (NEW)
forge.audio.createSnapshot(name: string): void;
forge.audio.applySnapshot(name: string, crossfadeMs?: number): void;

// Occlusion (NEW)
forge.audio.setOcclusion(entityId: string, enabled: boolean): void;
forge.audio.addOcclusionZone(zoneId: string, position: [number,number,number],
  halfExtents: [number,number,number], factor?: number): void;
forge.audio.removeOcclusionZone(zoneId: string): void;
```

### 6.2. Script Worker Integration

Each new method pushes a command object to `pendingCommands` in `scriptWorker.ts`. The main thread's `usePlayTick` hook processes these commands and routes them to either `audioManager` directly (for JS-side operations) or through `dispatchCommand` (for Rust-side operations like scene persistence).

---

## 7. MCP Commands

### 7.1. Existing Commands (6 -- keep as-is, fix implementations)

| Command | Status | Fix Needed |
|---------|--------|------------|
| `set_music_intensity` | Working | None |
| `set_music_stems` | Working | None |
| `set_adaptive_music` | Working | None |
| `transition_music_segment` | Broken | Wire to AudioManager |
| `create_audio_snapshot` | Broken | Fix crossfade timing, use Zustand |
| `apply_audio_snapshot` | Broken | Fix crossfade, capture full state |
| `set_audio_occlusion` | Working (basic) | Add zone-based support |

### 7.2. New Commands (5)

| Command | Description |
|---------|------------|
| `set_music_segments` | Define named segments with start times for horizontal re-sequencing |
| `set_music_bpm` | Set BPM for beat/bar-quantized transitions |
| `add_occlusion_zone` | Add an AABB occlusion zone with configurable attenuation |
| `remove_occlusion_zone` | Remove an occlusion zone by ID |
| `delete_audio_snapshot` | Remove a saved audio snapshot |

---

## 8. Rust-Side Changes

### 8.1. Minimal Rust Changes Required

Since audio execution is entirely JS-side, the Rust engine changes are limited to:

1. **Scene serialization**: Add `audio_snapshots` and `occlusion_zones` fields to the `.forge` scene file format so they persist with save/load. These are opaque JSON blobs passed through to JS.

2. **Command passthrough**: New commands (`set_music_segments`, `add_occlusion_zone`, etc.) can be handled as passthrough events that emit directly to JS without ECS involvement. The existing pattern for this is `apply_audio_playback` which just calls `events::emit_audio_playback()`.

3. **No new ECS components needed**: Occlusion zones and snapshots live in JS state. They serialize into the scene file's metadata section, not as entity components.

### 8.2. Scene File Schema Extension

```rust
// In scene_file.rs, SceneData struct:
pub audio_snapshots: Option<serde_json::Value>,  // Opaque JSON for JS
pub occlusion_zones: Option<serde_json::Value>,   // Opaque JSON for JS
pub adaptive_music_config: Option<serde_json::Value>, // Opaque JSON for JS
```

---

## 9. UI Changes

### 9.1. Audio Mixer Panel Additions

The existing `AudioMixerPanel` component gets two new sections:

1. **Snapshots tab**: List saved snapshots, create/delete/apply buttons, crossfade duration slider
2. **Occlusion zones list**: Show configured zones, add/edit/remove inline

### 9.2. Inspector Integration

No new inspector panels needed. Occlusion toggle added to existing `AudioInspector` as a checkbox (per-entity occlusion enable/disable).

---

## 10. Edge Cases and Constraints

1. **Browser autoplay policy**: All audio features must handle suspended AudioContext gracefully. Snapshots applied before user interaction should queue and replay after context resumes.

2. **WASM memory limit (4GB)**: Audio buffers live in JS heap, not WASM linear memory. No concern here.

3. **WebGPU vs WebGL2**: Audio features are rendering-backend independent. No conditional logic needed.

4. **Multiple adaptive tracks**: The system supports multiple named tracks (e.g., "exploration_music" and "ambient_wind") with independent intensity and segments.

5. **Hot reload in dev**: Snapshot state stored in Zustand persists through HMR. OcclusionManager interval must be cleaned up on component unmount.

6. **Export/runtime**: Snapshots and occlusion zones must be included in the game export bundle. The export pipeline already serializes the scene file; these new fields ride along.

7. **Segment boundaries with variable-length buffers**: If stems have different lengths, segment transitions must handle the shortest buffer gracefully (loop back to segment start rather than silence).
