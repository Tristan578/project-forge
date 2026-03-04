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

  it('SKELETON2D_UPDATED: calls setSkeleton2d', () => {
    const skeleton = { bones: [{ name: 'root', parent: null }] };
    const payload = { entityId: 'ent-1', skeleton };
    const result = handleAnimationEvent('SKELETON2D_UPDATED', payload as never, mockSetGet.set, mockSetGet.get);

    expect(result).toBe(true);
    expect(actions.setSkeleton2d).toHaveBeenCalledWith('ent-1', skeleton);
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
    expect(actions.setSkeleton2d).toHaveBeenCalledWith('ent-1', {
      bones: [],
      activeSkin: 'warrior',
    });
  });

  it('SKELETON2D_SKIN_CHANGED: ignores when no skeleton exists', () => {
    actions.skeletons2d = {};
    const payload = { entityId: 'ent-1', skinName: 'warrior' };
    const result = handleAnimationEvent('SKELETON2D_SKIN_CHANGED', payload as never, mockSetGet.set, mockSetGet.get);

    expect(result).toBe(true);
    expect(actions.setSkeleton2d).not.toHaveBeenCalled();
  });
});
