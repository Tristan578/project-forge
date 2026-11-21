import { beforeEach, describe, expect, it } from 'vitest';
import type { StoreApi } from 'zustand';
import { createSliceStore } from '@/stores/slices/__tests__/sliceTestTemplate';
import {
  applyArrangementToSceneData,
  createArrangementSlice,
  readArrangementFromSceneData,
  type ArrangementSlice,
} from '../arrangementStore';
import {
  ARRANGEMENT_SCENE_DATA_KEY,
  MAX_ARRANGEMENT_TRACKS,
  MAX_ARRANGEMENT_CLIPS,
  MAX_AUDIO_DURATION_SECONDS,
  MAX_TIMELINE_OFFSET_SECONDS,
  MAX_ARRANGEMENT_ID_LENGTH,
  MAX_ARRANGEMENT_NAME_LENGTH,
  MAX_AUDIO_SOURCE_LENGTH,
  clipsOverlap,
  createEmptyArrangement,
  overlappingClipIds,
  type MusicClip,
} from '../arrangementTypes';

let store: StoreApi<ArrangementSlice>;
const s = () => store.getState();
beforeEach(() => { store = createSliceStore(createArrangementSlice); });

const clip = (overrides: Partial<MusicClip> = {}): MusicClip => ({
  id: 'clip', trackId: 'track', sourceUrl: 'audio', sourceDurationSeconds: 10,
  startOffset: 0, trimStart: 0, trimEnd: 10, loopEnabled: false, name: 'Intro', ...overrides,
});
const scene = (overrides: Record<string, unknown> = {}) => ({
  [ARRANGEMENT_SCENE_DATA_KEY]: {
    ...createEmptyArrangement(),
    tracks: [{ id: 'track', name: 'Track', muted: false }],
    clips: [clip()],
    ...overrides,
  },
});

describe('source and timing boundaries', () => {
  it.each([0, -1, NaN, Infinity, -Infinity, MAX_AUDIO_DURATION_SECONDS + 1])(
    'rejects invalid source duration %s without adding a phantom track or dirty edit', (duration) => {
      expect(s().addGeneratedClip({ sourceUrl: 'audio', durationSeconds: duration })).toBeNull();
      expect(s().serialize()).toBeNull();
      expect(s().editRevision).toBe(0);
      const trackId = s().addTrack()!;
      s().hydrate(s().serialize());
      const revision = s().editRevision;
      expect(s().addClip({ trackId, sourceUrl: 'audio', sourceDurationSeconds: duration })).toBeNull();
      expect(s().arrangement.clips).toEqual([]);
      expect(s().canUndo).toBe(false);
      expect(s().editRevision).toBe(revision);
      expect(readArrangementFromSceneData(scene({ clips: [clip({ sourceDurationSeconds: duration })] }))!.clips).toEqual([]);
    },
  );

  it.each(['', '   ', 'a'.repeat(MAX_AUDIO_SOURCE_LENGTH + 1)])('rejects empty or oversized source references', (sourceUrl) => {
    expect(s().addGeneratedClip({ sourceUrl, durationSeconds: 10 })).toBeNull();
    expect(s().serialize()).toBeNull();
    expect(readArrangementFromSceneData(scene({ clips: [clip({ sourceUrl })] }))!.clips).toEqual([]);
  });

  it('keeps positive sources shorter than the usual minimum entirely within their real duration', () => {
    const id = s().addGeneratedClip({ sourceUrl: 'short', durationSeconds: 0.001 })!;
    s().trimClip(id, { trimStart: 99, trimEnd: -99 });
    expect(s().arrangement.clips[0]).toMatchObject({
      sourceDurationSeconds: 0.001, trimStart: 0, trimEnd: 0.001,
    });
  });

  it('accepts the duration ceiling and clamps huge imported and edited offsets', () => {
    const id = s().addGeneratedClip({ sourceUrl: 'long', durationSeconds: MAX_AUDIO_DURATION_SECONDS })!;
    s().moveClip(id, Number.MAX_VALUE);
    expect(s().arrangement.clips[0].startOffset).toBe(MAX_TIMELINE_OFFSET_SECONDS);
    const parsed = readArrangementFromSceneData(scene({ clips: [clip({ startOffset: Number.MAX_VALUE })] }))!;
    expect(parsed.clips[0].startOffset).toBe(MAX_TIMELINE_OFFSET_SECONDS);
  });

  it('rejects a generated clip targeting a missing explicit track without creating one', () => {
    expect(s().addGeneratedClip({ sourceUrl: 'audio', durationSeconds: 10, trackId: 'missing' })).toBeNull();
    expect(s().serialize()).toBeNull();
    expect(s().editRevision).toBe(0);
  });
});

describe('untrusted arrangement hydration', () => {
  it('drops blank, duplicate and oversized IDs and orphaned clips while keeping the first valid entry', () => {
    const parsed = readArrangementFromSceneData(scene({
      tracks: [
        { id: '', name: 'Empty' }, { id: '  ', name: 'Blank' },
        { id: ' padded ', name: 'Padded' }, { id: 'x'.repeat(MAX_ARRANGEMENT_ID_LENGTH + 1) },
        { id: 'track', name: 'First', muted: false }, { id: 'track', name: 'Duplicate' },
      ],
      clips: [
        clip({ id: '' }), clip({ id: '  ' }), clip({ id: 'p'.repeat(MAX_ARRANGEMENT_ID_LENGTH + 1) }),
        clip({ name: 'First clip' }), clip({ name: 'Duplicate clip' }),
        clip({ id: 'orphan', trackId: 'missing' }), clip({ id: 'blank-track', trackId: '' }),
      ],
    }))!;
    expect(parsed.tracks).toEqual([{ id: 'track', name: 'First', muted: false }]);
    expect(parsed.clips).toEqual([clip({ name: 'First clip' })]);
  });

  it('accepts opaque prototype-like IDs without treating them as object properties', () => {
    const parsed = readArrangementFromSceneData(scene({
      tracks: [{ id: '__proto__', name: 'Track', muted: false }],
      clips: [clip({ id: 'constructor', trackId: '__proto__' })],
    }))!;
    expect(parsed.tracks[0].id).toBe('__proto__');
    expect(parsed.clips[0].id).toBe('constructor');
  });

  it.each([0, -1, 2, NaN, Infinity, '1'])('rejects unsupported schema version %s', (version) => {
    expect(readArrangementFromSceneData(scene({ version }))).toBeNull();
  });

  it('bounds imported collections as a whole rather than silently truncating them', () => {
    expect(readArrangementFromSceneData(scene({
      tracks: Array.from({ length: MAX_ARRANGEMENT_TRACKS + 1 }, (_, index) => ({ id: `t${index}` })),
    }))).toBeNull();
    expect(readArrangementFromSceneData(scene({
      clips: Array.from({ length: MAX_ARRANGEMENT_CLIPS + 1 }, (_, index) => clip({ id: `c${index}` })),
    }))).toBeNull();
  });

  it('applies the same collection limits to new edits after importing maximum-sized metadata', () => {
    const arrangement = readArrangementFromSceneData(scene({
      tracks: Array.from({ length: MAX_ARRANGEMENT_TRACKS }, (_, index) => ({ id: `t${index}`, name: `Track ${index}` })),
      clips: Array.from({ length: MAX_ARRANGEMENT_CLIPS }, (_, index) => clip({ id: `c${index}`, trackId: 't0' })),
    }))!;
    s().hydrate(arrangement);
    expect(s().addTrack()).toBeNull();
    expect(s().addClip({ trackId: 't0', sourceUrl: 'extra', sourceDurationSeconds: 1 })).toBeNull();
    expect(s().addGeneratedClip({ sourceUrl: 'extra', durationSeconds: 1 })).toBeNull();
    expect(s().addGeneratedClip({ sourceUrl: 'extra', durationSeconds: 1, trackId: 't0' })).toBeNull();
    expect(s().arrangement.tracks).toHaveLength(MAX_ARRANGEMENT_TRACKS);
    expect(s().arrangement.clips).toHaveLength(MAX_ARRANGEMENT_CLIPS);
    expect(s().canUndo).toBe(false);
    expect(s().editRevision).toBe(0);
  });

  it('validates direct hydration and bounds persisted labels', () => {
    const raw = scene({
      tracks: [{ id: 'track', name: 'n'.repeat(MAX_ARRANGEMENT_NAME_LENGTH + 1) }],
      clips: [clip({ name: 'c'.repeat(MAX_ARRANGEMENT_NAME_LENGTH + 1) }), clip({ id: 'bad', sourceDurationSeconds: 0 })],
    })[ARRANGEMENT_SCENE_DATA_KEY];
    s().hydrate(raw);
    expect(s().arrangement.tracks[0].name).toHaveLength(MAX_ARRANGEMENT_NAME_LENGTH);
    expect(s().arrangement.clips).toHaveLength(1);
    expect(s().arrangement.clips[0].name).toHaveLength(MAX_ARRANGEMENT_NAME_LENGTH);
  });

  it('persists a tempo-only edit and does not alias its overlaid scene data', () => {
    s().setTempoBpm(145);
    const snapshot = s().serialize()!;
    expect(snapshot.tempoBpm).toBe(145);
    const persisted = applyArrangementToSceneData({ entities: [] }, snapshot);
    snapshot.tempoBpm = 200;
    expect(readArrangementFromSceneData(persisted)!.tempoBpm).toBe(145);
    s().hydrate(readArrangementFromSceneData(persisted));
    expect(s().arrangement.tempoBpm).toBe(145);
  });
});

describe('overlap sweep', () => {
  it('marks nested and chained overlaps, excluding touching windows and other tracks', () => {
    const clips = [
      clip({ id: 'outer', trimEnd: 10 }),
      clip({ id: 'nested-a', startOffset: 1, trimEnd: 1 }),
      clip({ id: 'nested-b', startOffset: 4, trimEnd: 1 }),
      clip({ id: 'chain', startOffset: 9, trimEnd: 3 }),
      clip({ id: 'touching', startOffset: 12, trimEnd: 2 }),
      clip({ id: 'other-track', trackId: '__proto__' }),
    ];
    const originalOrder = clips.map((item) => item.id);
    expect(overlappingClipIds(clips)).toEqual(new Set(['outer', 'nested-a', 'nested-b', 'chain']));
    expect(clips.map((item) => item.id)).toEqual(originalOrder);
  });

  it('agrees with pairwise overlap detection for a dense mixed-track fixture', () => {
    const clips = Array.from({ length: 200 }, (_, index) => clip({
      id: `clip-${index}`, trackId: index % 3 === 0 ? '__proto__' : `track-${index % 4}`,
      startOffset: (index * 17) % 101, trimEnd: 1 + (index % 10),
    }));
    const expected = new Set(clips.filter((item) => clips.some((other) => clipsOverlap(item, other))).map((item) => item.id));
    expect(overlappingClipIds(clips)).toEqual(expected);
  });
});
