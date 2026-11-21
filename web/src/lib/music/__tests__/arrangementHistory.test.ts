import { beforeEach, describe, expect, it } from 'vitest';
import type { StoreApi } from 'zustand';
import { createSliceStore } from '@/stores/slices/__tests__/sliceTestTemplate';
import { createArrangementSlice, type ArrangementSlice } from '../arrangementStore';
import { ARRANGEMENT_HISTORY_LIMIT } from '../arrangementTypes';

let store: StoreApi<ArrangementSlice>;
const s = () => store.getState();
beforeEach(() => { store = createSliceStore(createArrangementSlice); });

function seed() {
  const trackId = s().addTrack('Lead')!;
  const secondTrack = s().addTrack('Bass')!;
  const clipId = s().addClip({ trackId, sourceUrl: 'intro', sourceDurationSeconds: 10 })!;
  s().hydrate(s().serialize());
  return { trackId, secondTrack, clipId };
}

describe('arrangement edit history', () => {
  it('undoes and redoes metadata edits, clip deletion, track deletion and clearing', () => {
    const { trackId, secondTrack, clipId } = seed();
    const edits = [
      () => s().renameTrack(trackId, 'Melody'),
      () => s().setTrackMuted(trackId, true),
      () => s().moveClip(clipId, 12, secondTrack),
      () => s().trimClip(clipId, { trimStart: 2, trimEnd: 8 }),
      () => s().setLoopPoints(clipId, { loopEnabled: true, trimStart: 3, trimEnd: 7 }),
      () => s().setTempoBpm(150),
      () => s().deleteClip(clipId),
      () => s().deleteTrack(secondTrack),
      () => s().clearArrangement(),
    ];
    const snapshots = [s().serialize()];
    for (const edit of edits) {
      edit();
      snapshots.push(s().serialize());
    }
    for (let index = edits.length - 1; index >= 0; index -= 1) {
      expect(s().canUndo).toBe(true);
      s().undo();
      expect(s().serialize()).toEqual(snapshots[index]);
    }
    expect(s().canUndo).toBe(false);
    for (let index = 1; index < snapshots.length; index += 1) {
      expect(s().canRedo).toBe(true);
      s().redo();
      expect(s().serialize()).toEqual(snapshots[index]);
    }
    expect(s().canRedo).toBe(false);
  });

  it('restores a deleted track together with all of its clips', () => {
    const { trackId } = seed();
    s().addClip({ trackId, sourceUrl: 'second', sourceDurationSeconds: 3 });
    s().hydrate(s().serialize());
    const original = s().serialize();
    s().deleteTrack(trackId);
    expect(s().arrangement.clips).toEqual([]);
    s().undo();
    expect(s().serialize()).toEqual(original);
    expect(s().canUndo).toBe(false);
  });

  it('adds generated audio and its new track as one undoable edit', () => {
    s().addGeneratedClip({ sourceUrl: 'generated-intro', durationSeconds: 20 });
    expect(s().arrangement.tracks).toHaveLength(1);
    expect(s().arrangement.clips).toHaveLength(1);
    expect(s().editRevision).toBe(1);
    s().undo();
    expect(s().serialize()).toBeNull();
    expect(s().canUndo).toBe(false);
    s().redo();
    expect(s().arrangement.tracks).toHaveLength(1);
    expect(s().arrangement.clips).toHaveLength(1);
  });

  it('does not dirty state, consume history, or discard redo for no-op edits', () => {
    const { trackId, clipId } = seed();
    s().moveClip(clipId, 5);
    s().undo();
    const arrangement = s().arrangement;
    const revision = s().editRevision;
    s().renameTrack(trackId, 'Lead');
    s().renameTrack(trackId, '   ');
    s().setTrackMuted(trackId, false);
    s().setTempoBpm(120);
    s().setTempoBpm(NaN);
    s().moveClip(clipId, 0);
    s().moveClip(clipId, NaN);
    s().trimClip(clipId, { trimStart: 0, trimEnd: 999 });
    s().setLoopPoints(clipId, { loopEnabled: false });
    s().deleteClip('missing');
    s().deleteTrack('missing');
    s().renameTrack('missing', 'Renamed');
    s().setTrackMuted('missing', true);
    s().trimClip('missing', { trimEnd: 2 });
    s().addClip({ trackId: 'missing', sourceUrl: 'a', sourceDurationSeconds: 10 });
    expect(s().arrangement).toBe(arrangement);
    expect(s().editRevision).toBe(revision);
    expect(s().canUndo).toBe(false);
    expect(s().canRedo).toBe(true);
    s().redo();
    expect(s().arrangement.clips[0].startOffset).toBe(5);
  });

  it('discards redo when a different actual edit follows undo', () => {
    const { trackId, clipId } = seed();
    s().moveClip(clipId, 5);
    s().undo();
    s().renameTrack(trackId, 'New lead');
    expect(s().canRedo).toBe(false);
    s().redo();
    expect(s().arrangement.clips[0].startOffset).toBe(0);
  });

  it('caps undo history and keeps redo within that same bound', () => {
    for (let index = 0; index < ARRANGEMENT_HISTORY_LIMIT + 5; index += 1) s().setTempoBpm(121 + index);
    for (let index = 0; index < ARRANGEMENT_HISTORY_LIMIT; index += 1) s().undo();
    expect(s().arrangement.tempoBpm).toBe(125);
    expect(s().canUndo).toBe(false);
    const revision = s().editRevision;
    s().undo();
    expect(s().editRevision).toBe(revision);
    for (let index = 0; index < ARRANGEMENT_HISTORY_LIMIT; index += 1) s().redo();
    expect(s().arrangement.tempoBpm).toBe(175);
    expect(s().canRedo).toBe(false);
  });

  it('marks edits, undo and redo for autosave while scene hydration/reset clears history silently', () => {
    const dirtyRevisions: number[] = [];
    const unsubscribe = store.subscribe((current, previous) => {
      if (current.editRevision !== previous.editRevision) dirtyRevisions.push(current.editRevision);
    });
    s().addTrack('Original');
    const snapshot = s().serialize();
    s().undo();
    s().redo();
    expect(dirtyRevisions).toEqual([1, 2, 3]);
    s().hydrate(snapshot);
    expect(s().canUndo).toBe(false);
    expect(s().canRedo).toBe(false);
    s().addTrack('Other');
    s().reset();
    expect(s().serialize()).toBeNull();
    expect(s().canUndo).toBe(false);
    expect(s().canRedo).toBe(false);
    expect(dirtyRevisions).toEqual([1, 2, 3, 4]);
    unsubscribe();
  });

  it('does not let caller-owned persistence snapshots mutate current state or history', () => {
    seed();
    const snapshot = s().serialize()!;
    snapshot.tracks[0].name = 'Mutated outside';
    expect(s().arrangement.tracks[0].name).toBe('Lead');
    s().hydrate(snapshot);
    snapshot.clips[0].trimEnd = -1;
    expect(s().arrangement.clips[0].trimEnd).toBe(10);
    s().clearArrangement();
    s().undo();
    expect(s().arrangement.clips[0].trimEnd).toBe(10);
  });

  it('clearing an already empty arrangement leaves history and dirty revision empty', () => {
    s().clearArrangement();
    s().undo();
    s().redo();
    expect(s().editRevision).toBe(0);
    expect(s().canUndo).toBe(false);
    expect(s().canRedo).toBe(false);
  });
});
