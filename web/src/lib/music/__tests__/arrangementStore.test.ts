/**
 * Unit + boundary tests for the music arrangement store and its persistence
 * helpers (music.FR-2.OP-01 track/clip arrangement, music.FR-2.OP-02
 * trim/loop). #9854.
 *
 * Tests mount the slice in isolation via the sliceTestTemplate pattern so no
 * app singletons leak between cases.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { StoreApi } from 'zustand';
import { createSliceStore } from '@/stores/slices/__tests__/sliceTestTemplate';
import {
  createArrangementSlice,
  applyArrangementToSceneData,
  readArrangementFromSceneData,
  type ArrangementSlice,
} from '../arrangementStore';
import {
  ARRANGEMENT_SCENE_DATA_KEY,
  ARRANGEMENT_VERSION,
  MIN_CLIP_LENGTH_SECONDS,
  clampTrimWindow,
  clipsOverlap,
  createEmptyArrangement,
  type MusicArrangement,
} from '../arrangementTypes';

let store: StoreApi<ArrangementSlice>;
beforeEach(() => {
  store = createSliceStore(createArrangementSlice);
});
const s = () => store.getState();

describe('music.FR-2.OP-01 — track/clip arrangement CRUD', () => {
  it('starts empty', () => {
    expect(s().arrangement.tracks).toHaveLength(0);
    expect(s().arrangement.clips).toHaveLength(0);
    expect(s().arrangement.version).toBe(ARRANGEMENT_VERSION);
  });

  it('adds a track and returns its id', () => {
    const id = s().addTrack('Lead');
    expect(id).toMatch(/^track_/);
    expect(s().arrangement.tracks).toEqual([{ id, name: 'Lead', muted: false }]);
  });

  it('auto-names tracks when no name is given', () => {
    s().addTrack();
    s().addTrack();
    expect(s().arrangement.tracks.map((t) => t.name)).toEqual(['Track 1', 'Track 2']);
  });

  it('adds a clip onto a track and clamps trim to the source length', () => {
    const trackId = s().addTrack();
    const clipId = s().addClip({ trackId, sourceUrl: 'music-intro', sourceDurationSeconds: 30 });
    expect(clipId).not.toBeNull();
    const clip = s().arrangement.clips[0];
    expect(clip).toMatchObject({
      trackId,
      sourceUrl: 'music-intro',
      sourceDurationSeconds: 30,
      startOffset: 0,
      trimStart: 0,
      trimEnd: 30,
      loopEnabled: false,
      name: 'music-intro',
    });
  });

  it('adding a clip to an unknown (empty) track is a no-op, not a phantom clip', () => {
    const clipId = s().addClip({ trackId: 'nope', sourceUrl: 'x', sourceDurationSeconds: 10 });
    expect(clipId).toBeNull();
    expect(s().arrangement.clips).toHaveLength(0);
  });

  it('moves a clip along the timeline and clamps negative offsets to 0', () => {
    const trackId = s().addTrack();
    const clipId = s().addClip({ trackId, sourceUrl: 'a', sourceDurationSeconds: 10 })!;
    s().moveClip(clipId, 12.5);
    expect(s().arrangement.clips[0].startOffset).toBe(12.5);
    s().moveClip(clipId, -4);
    expect(s().arrangement.clips[0].startOffset).toBe(0);
  });

  it('moves a clip to another track, ignoring an unknown target track', () => {
    const t1 = s().addTrack();
    const t2 = s().addTrack();
    const clipId = s().addClip({ trackId: t1, sourceUrl: 'a', sourceDurationSeconds: 10 })!;
    s().moveClip(clipId, 1, t2);
    expect(s().arrangement.clips[0].trackId).toBe(t2);
    s().moveClip(clipId, 2, 'ghost-track');
    expect(s().arrangement.clips[0].trackId).toBe(t2); // unchanged
  });

  it('deletes a clip', () => {
    const trackId = s().addTrack();
    const clipId = s().addClip({ trackId, sourceUrl: 'a', sourceDurationSeconds: 10 })!;
    s().deleteClip(clipId);
    expect(s().arrangement.clips).toHaveLength(0);
  });

  it('deleting a track removes its clips but keeps other tracks', () => {
    const t1 = s().addTrack();
    const t2 = s().addTrack();
    s().addClip({ trackId: t1, sourceUrl: 'a', sourceDurationSeconds: 10 });
    s().addClip({ trackId: t2, sourceUrl: 'b', sourceDurationSeconds: 10 });
    s().deleteTrack(t1);
    expect(s().arrangement.tracks.map((t) => t.id)).toEqual([t2]);
    expect(s().arrangement.clips.map((c) => c.trackId)).toEqual([t2]);
  });

  it('deleting an empty track is a no-op on clips', () => {
    const t1 = s().addTrack();
    s().deleteTrack(t1);
    expect(s().arrangement.tracks).toHaveLength(0);
    expect(s().arrangement.clips).toHaveLength(0);
  });
});

describe('music.FR-2.OP-02 — trim, loop points, boundaries', () => {
  const seed = () => {
    const trackId = s().addTrack();
    const clipId = s().addClip({ trackId, sourceUrl: 'a', sourceDurationSeconds: 20 })!;
    return { trackId, clipId };
  };

  it('trims within bounds', () => {
    const { clipId } = seed();
    s().trimClip(clipId, { trimStart: 5, trimEnd: 15 });
    expect(s().arrangement.clips[0]).toMatchObject({ trimStart: 5, trimEnd: 15 });
  });

  it('clamps a trimEnd past the source length back to the source length (trim beyond bounds)', () => {
    const { clipId } = seed();
    s().trimClip(clipId, { trimEnd: 999 });
    expect(s().arrangement.clips[0].trimEnd).toBe(20);
  });

  it('clamps a negative trimStart to 0', () => {
    const { clipId } = seed();
    s().trimClip(clipId, { trimStart: -7 });
    expect(s().arrangement.clips[0].trimStart).toBe(0);
  });

  it('never lets trimStart cross trimEnd — enforces the minimum clip length', () => {
    const { clipId } = seed();
    s().trimClip(clipId, { trimStart: 18, trimEnd: 18 });
    const clip = s().arrangement.clips[0];
    expect(clip.trimEnd - clip.trimStart).toBeGreaterThanOrEqual(MIN_CLIP_LENGTH_SECONDS);
  });

  it('sets loop points and toggles looping in one operation', () => {
    const { clipId } = seed();
    s().setLoopPoints(clipId, { loopEnabled: true, trimStart: 2, trimEnd: 8 });
    expect(s().arrangement.clips[0]).toMatchObject({ loopEnabled: true, trimStart: 2, trimEnd: 8 });
    s().setLoopPoints(clipId, { loopEnabled: false });
    expect(s().arrangement.clips[0].loopEnabled).toBe(false);
  });

  it('clampTrimWindow handles a zero-duration source without producing NaN', () => {
    const { trimStart, trimEnd } = clampTrimWindow(0, 0, 0);
    expect(Number.isFinite(trimStart)).toBe(true);
    expect(Number.isFinite(trimEnd)).toBe(true);
    expect(trimEnd).toBeGreaterThanOrEqual(trimStart);
  });
});

describe('overlap detection (boundary: overlapping clips)', () => {
  it('detects overlap on the same track and ignores clips on other tracks', () => {
    const t1 = s().addTrack();
    const t2 = s().addTrack();
    const c1 = s().addClip({ trackId: t1, sourceUrl: 'a', sourceDurationSeconds: 10 })!;
    const c2 = s().addClip({ trackId: t1, sourceUrl: 'b', sourceDurationSeconds: 10 })!;
    const c3 = s().addClip({ trackId: t2, sourceUrl: 'c', sourceDurationSeconds: 10 })!;
    // c1 at 0..10, c2 moved to 5 -> overlaps; c3 on a different track never conflicts.
    s().moveClip(c2, 5);
    const clips = s().arrangement.clips;
    const clip = (id: string) => clips.find((c) => c.id === id)!;
    expect(clipsOverlap(clip(c1), clip(c2))).toBe(true);
    expect(clipsOverlap(clip(c1), clip(c3))).toBe(false);
    // Non-overlapping once moved clear.
    s().moveClip(c2, 50);
    const after = s().arrangement.clips;
    expect(clipsOverlap(after.find((c) => c.id === c1)!, after.find((c) => c.id === c2)!)).toBe(false);
  });
});

describe('generated/imported audio hand-off', () => {
  it('creates a Music track when none exists and places the generated clip on it', () => {
    const clipId = s().addGeneratedClip({ sourceUrl: 'music-boss', durationSeconds: 45 });
    expect(clipId).toMatch(/^clip_/);
    expect(s().arrangement.tracks).toHaveLength(1);
    expect(s().arrangement.tracks[0].name).toBe('Music');
    expect(s().arrangement.clips[0]).toMatchObject({ sourceUrl: 'music-boss', sourceDurationSeconds: 45 });
  });

  it('reuses an existing track when a valid trackId is passed', () => {
    const trackId = s().addTrack('Existing');
    s().addGeneratedClip({ sourceUrl: 'm', durationSeconds: 10, trackId });
    expect(s().arrangement.tracks).toHaveLength(1);
    expect(s().arrangement.clips[0].trackId).toBe(trackId);
  });
});

describe('serialize / hydrate', () => {
  it('serialize returns null for an empty arrangement', () => {
    expect(s().serialize()).toBeNull();
  });

  it('round-trips a non-empty arrangement through hydrate', () => {
    const trackId = s().addTrack('T');
    s().addClip({ trackId, sourceUrl: 'a', sourceDurationSeconds: 10 });
    const snapshot = s().serialize();
    expect(snapshot).not.toBeNull();

    const other = createSliceStore(createArrangementSlice);
    other.getState().hydrate(snapshot);
    expect(other.getState().arrangement).toEqual(snapshot);
  });

  it('hydrate(null) clears the arrangement', () => {
    s().addTrack();
    s().hydrate(null);
    expect(s().arrangement.tracks).toHaveLength(0);
  });
});

describe('persistence via existing sceneData path', () => {
  const nonEmpty = (): MusicArrangement => {
    const a = createEmptyArrangement();
    a.tracks.push({ id: 'tk', name: 'T', muted: false });
    a.clips.push({
      id: 'cl',
      trackId: 'tk',
      sourceUrl: 'music-intro',
      sourceDurationSeconds: 30,
      startOffset: 4,
      trimStart: 1,
      trimEnd: 20,
      loopEnabled: true,
      name: 'Intro',
    });
    return a;
  };

  it('applyArrangementToSceneData merges under the namespaced key and preserves scene entities', () => {
    const sceneData = { formatVersion: 3, entities: [{ id: 'e1' }] };
    const merged = applyArrangementToSceneData(sceneData, nonEmpty());
    expect(merged.entities).toEqual([{ id: 'e1' }]);
    expect(merged[ARRANGEMENT_SCENE_DATA_KEY]).toEqual(nonEmpty());
    // Original object is not mutated.
    expect(ARRANGEMENT_SCENE_DATA_KEY in sceneData).toBe(false);
  });

  it('applyArrangementToSceneData removes the key for a null/empty arrangement', () => {
    const sceneData = { entities: [], [ARRANGEMENT_SCENE_DATA_KEY]: nonEmpty() };
    expect(applyArrangementToSceneData(sceneData, null)[ARRANGEMENT_SCENE_DATA_KEY]).toBeUndefined();
    expect(applyArrangementToSceneData(sceneData, createEmptyArrangement())[ARRANGEMENT_SCENE_DATA_KEY]).toBeUndefined();
  });

  it('readArrangementFromSceneData round-trips a saved arrangement', () => {
    const merged = applyArrangementToSceneData({ entities: [] }, nonEmpty());
    expect(readArrangementFromSceneData(merged)).toEqual(nonEmpty());
  });

  it('readArrangementFromSceneData returns null when no arrangement is present', () => {
    expect(readArrangementFromSceneData({ entities: [] })).toBeNull();
    expect(readArrangementFromSceneData(null)).toBeNull();
    expect(readArrangementFromSceneData('nope')).toBeNull();
  });

  it('drops orphaned clips whose track did not survive, and rejects malformed entries', () => {
    const sceneData = {
      [ARRANGEMENT_SCENE_DATA_KEY]: {
        version: 1,
        tempoBpm: 120,
        tracks: [{ id: 'tk', name: 'T', muted: false }, { name: 'no id' }],
        clips: [
          { id: 'good', trackId: 'tk', sourceUrl: 'a', sourceDurationSeconds: 10, startOffset: 0, trimStart: 0, trimEnd: 10, loopEnabled: false, name: 'a' },
          { id: 'orphan', trackId: 'gone', sourceUrl: 'b', sourceDurationSeconds: 10, startOffset: 0, trimStart: 0, trimEnd: 10, loopEnabled: false, name: 'b' },
          { trackId: 'tk', sourceUrl: 'c' }, // missing id -> dropped
        ],
      },
    };
    const parsed = readArrangementFromSceneData(sceneData)!;
    expect(parsed.tracks.map((t) => t.id)).toEqual(['tk']);
    expect(parsed.clips.map((c) => c.id)).toEqual(['good']);
  });

  it('sanitises out-of-range trims coming from untrusted JSON', () => {
    const sceneData = {
      [ARRANGEMENT_SCENE_DATA_KEY]: {
        tracks: [{ id: 'tk', name: 'T', muted: false }],
        clips: [
          { id: 'c', trackId: 'tk', sourceUrl: 'a', sourceDurationSeconds: 10, startOffset: -3, trimStart: -5, trimEnd: 999, loopEnabled: 'yes', name: 'a' },
        ],
      },
    };
    const clip = readArrangementFromSceneData(sceneData)!.clips[0];
    expect(clip.startOffset).toBe(0);
    expect(clip.trimStart).toBe(0);
    expect(clip.trimEnd).toBe(10);
    expect(clip.loopEnabled).toBe(false); // non-boolean coerced to false
  });
});
