import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockSetGet, createMockActions, type StoreState } from './eventTestUtils';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: {
    getState: vi.fn(),
    setState: vi.fn(),
    subscribe: vi.fn(),
  },
}));

import { useEditorStore } from '@/stores/editorStore';
import { handleAnimationEvent } from '../animationEvents';

describe('handleAnimationEvent', () => {
  let actions: ReturnType<typeof createMockActions>;
  let mockSetGet: ReturnType<typeof createMockSetGet>;

  beforeEach(() => {
    actions = createMockActions();
    mockSetGet = createMockSetGet();
    vi.mocked(useEditorStore.getState).mockReturnValue(actions as unknown as StoreState);
    vi.mocked(useEditorStore.setState).mockClear();
  });

  it('returns false for unknown event types', () => {
    expect(handleAnimationEvent('UNKNOWN', {}, mockSetGet.set, mockSetGet.get)).toBe(false);
  });

  it('ANIMATION_STATE_CHANGED: calls setEntityAnimation', () => {
    const payload = { entityId: 'ent-1', playing: true, clipName: 'walk', time: 0.5 };
    const result = handleAnimationEvent('ANIMATION_STATE_CHANGED', payload as never, mockSetGet.set, mockSetGet.get);

    expect(result).toBe(true);
    expect(actions.setEntityAnimation).toHaveBeenCalledWith('ent-1', payload);
  });

  it('ANIMATION_LIST_CHANGED: calls setEntityAnimation', () => {
    const payload = { entityId: 'ent-1', playing: false, clips: ['idle', 'walk'] };
    const result = handleAnimationEvent('ANIMATION_LIST_CHANGED', payload as never, mockSetGet.set, mockSetGet.get);

    expect(result).toBe(true);
    expect(actions.setEntityAnimation).toHaveBeenCalledWith('ent-1', payload);
  });

  it('ANIMATION_CLIP_CHANGED: sets primaryAnimationClip when entity is selected', () => {
    actions.primaryId = 'ent-1';
    const payload = { entityId: 'ent-1', duration: 5.0, keyframes: [] };
    const result = handleAnimationEvent('ANIMATION_CLIP_CHANGED', payload as never, mockSetGet.set, mockSetGet.get);

    expect(result).toBe(true);
    expect(useEditorStore.setState).toHaveBeenCalledWith({
      primaryAnimationClip: { duration: 5.0, keyframes: [] },
    });
  });

  it('ANIMATION_CLIP_CHANGED: ignores when different entity is selected', () => {
    actions.primaryId = 'other-ent';
    const payload = { entityId: 'ent-1', duration: 5.0, keyframes: [] };
    const result = handleAnimationEvent('ANIMATION_CLIP_CHANGED', payload as never, mockSetGet.set, mockSetGet.get);

    expect(result).toBe(true);
    expect(useEditorStore.setState).not.toHaveBeenCalled();
  });

  // The emitted payload is `{ entityId, data, enabled }` — the rig is under
  // `data`, in the engine's wire shape. This test used to read a `skeleton` key
  // nothing emits and assert the DISPATCHING `setSkeleton2d`, which is the
  // echo-loop bug: a full-replace `create_skeleton2d` fired straight back at the
  // engine that had just described the rig.
  it('SKELETON2D_UPDATED: mirrors the engine rig without dispatching back', () => {
    const payload = {
      entityId: 'ent-1',
      data: {
        bones: [{ name: 'root', parentBone: null, localPosition: [1, 2, 0], localRotation: 0.5 }],
        activeSkin: 'default',
      },
      enabled: true,
    };
    const result = handleAnimationEvent('SKELETON2D_UPDATED', payload as never, mockSetGet.set, mockSetGet.get);

    expect(result).toBe(true);
    expect(actions.applySkeleton2dFromEngine).toHaveBeenCalledWith('ent-1', {
      bones: [{
        name: 'root',
        parentBone: null,
        localPosition: [1, 2],
        localRotation: 0.5,
        localScale: [1, 1],
        length: 50,
        color: [1, 1, 1, 1],
      }],
      slots: [],
      skins: {},
      activeSkin: 'default',
      ikConstraints: [],
    });
    expect(actions.setSkeleton2d).not.toHaveBeenCalled();
  });

  it('SKELETON2D_UPDATED: ignores a malformed rig rather than writing an empty one', () => {
    const result = handleAnimationEvent(
      'SKELETON2D_UPDATED',
      { entityId: 'ent-1', data: 'nonsense' } as never,
      mockSetGet.set,
      mockSetGet.get
    );

    expect(result).toBe(true);
    expect(actions.applySkeleton2dFromEngine).not.toHaveBeenCalled();
  });

  // `SKELETON2D_UPDATED` cannot carry a removal: its payload requires a rig,
  // and the handler above drops any payload it cannot parse. Before the engine
  // grew a removal event, `remove_skeleton_2d` and undo/redo left the browser
  // holding a rig the engine had dropped, and the next bone edit was authored
  // against a skeleton that no longer existed.
  it('SKELETON2D_REMOVED: drops the mirrored rig without dispatching back', () => {
    const result = handleAnimationEvent(
      'SKELETON2D_REMOVED',
      { entityId: 'ent-1' } as never,
      mockSetGet.set,
      mockSetGet.get
    );

    expect(result).toBe(true);
    expect(actions.applySkeleton2dRemovedFromEngine).toHaveBeenCalledWith('ent-1');
    // `removeSkeleton2d` dispatches `remove_skeleton_2d` — driving it from an
    // inbound event echoes the removal straight back at the engine.
    expect(actions.removeSkeleton2d).not.toHaveBeenCalled();
    expect(actions.setSkeleton2d).not.toHaveBeenCalled();
  });

  it('SKELETAL_ANIMATION2D_PLAYING: returns true (no-op)', () => {
    const result = handleAnimationEvent('SKELETAL_ANIMATION2D_PLAYING', {}, mockSetGet.set, mockSetGet.get);
    expect(result).toBe(true);
  });

  it('SKELETON2D_SKIN_CHANGED: updates skin when skeleton exists', () => {
    actions.skeletons2d = { 'ent-1': { bones: [], activeSkin: 'default' } };
    const payload = { entityId: 'ent-1', skinName: 'warrior' };
    const result = handleAnimationEvent('SKELETON2D_SKIN_CHANGED', payload as never, mockSetGet.set, mockSetGet.get);

    expect(result).toBe(true);
    expect(actions.applySkeleton2dFromEngine).toHaveBeenCalledWith('ent-1', {
      bones: [],
      activeSkin: 'warrior',
    });
    expect(actions.setSkeleton2d).not.toHaveBeenCalled();
  });

  it('SKELETON2D_SKIN_CHANGED: ignores when no skeleton exists', () => {
    actions.skeletons2d = {};
    const payload = { entityId: 'ent-1', skinName: 'warrior' };
    const result = handleAnimationEvent('SKELETON2D_SKIN_CHANGED', payload as never, mockSetGet.set, mockSetGet.get);

    expect(result).toBe(true);
    expect(actions.applySkeleton2dFromEngine).not.toHaveBeenCalled();
  });

  it('SKELETON2D_SKIN_CHANGED: does not resolve an inherited prototype key', () => {
    // A bare `skeletons2d['__proto__']` read is truthy, and spreading it writes
    // garbage into the store under that id.
    actions.skeletons2d = {};
    const result = handleAnimationEvent(
      'SKELETON2D_SKIN_CHANGED',
      { entityId: '__proto__', skinName: 'warrior' } as never,
      mockSetGet.set,
      mockSetGet.get
    );

    expect(result).toBe(true);
    expect(actions.applySkeleton2dFromEngine).not.toHaveBeenCalled();
  });

  it('SKELETON2D_SKIN_CHANGED: ignores a non-string skin name', () => {
    actions.skeletons2d = { 'ent-1': { bones: [], activeSkin: 'default' } };
    const result = handleAnimationEvent(
      'SKELETON2D_SKIN_CHANGED',
      { entityId: 'ent-1', skinName: 42 } as never,
      mockSetGet.set,
      mockSetGet.get
    );

    expect(result).toBe(true);
    expect(actions.applySkeleton2dFromEngine).not.toHaveBeenCalled();
  });
});
