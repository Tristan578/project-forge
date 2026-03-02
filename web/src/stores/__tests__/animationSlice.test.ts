/**
 * Unit tests for the animationSlice — 3D + 2D skeletal animation state.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createAnimationSlice, setAnimationDispatcher, type AnimationSlice } from '../slices/animationSlice';

function createTestStore() {
  const store = { state: null as unknown as AnimationSlice };
  const set = (partial: Partial<AnimationSlice> | ((s: AnimationSlice) => Partial<AnimationSlice>)) => {
    if (typeof partial === 'function') {
      Object.assign(store.state, partial(store.state));
    } else {
      Object.assign(store.state, partial);
    }
  };
  const get = () => store.state;
  store.state = createAnimationSlice(set as never, get as never, {} as never);
  return { getState: () => store.state };
}

describe('animationSlice', () => {
  let store: ReturnType<typeof createTestStore>;
  let mockDispatch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockDispatch = vi.fn();
    setAnimationDispatcher(mockDispatch as (command: string, payload: unknown) => void);
    store = createTestStore();
  });

  describe('Initial state', () => {
    it('should have null primary animation', () => {
      expect(store.getState().primaryAnimation).toBeNull();
    });

    it('should have null primary animation clip', () => {
      expect(store.getState().primaryAnimationClip).toBeNull();
    });

    it('should have empty skeleton maps', () => {
      expect(store.getState().skeletons2d).toEqual({});
      expect(store.getState().skeletalAnimations2d).toEqual({});
    });

    it('should have null selected bone', () => {
      expect(store.getState().selectedBone).toBeNull();
    });
  });

  describe('Playback controls', () => {
    it('playAnimation dispatches with undefined crossfade when not provided', () => {
      store.getState().playAnimation('ent-1', 'walk');
      expect(mockDispatch).toHaveBeenCalledWith('play_animation', {
        entityId: 'ent-1', clipName: 'walk', crossfadeSecs: undefined,
      });
    });

    it('playAnimation dispatches with custom crossfade', () => {
      store.getState().playAnimation('ent-1', 'run', 0.5);
      expect(mockDispatch).toHaveBeenCalledWith('play_animation', {
        entityId: 'ent-1', clipName: 'run', crossfadeSecs: 0.5,
      });
    });

    it('pauseAnimation dispatches', () => {
      store.getState().pauseAnimation('ent-1');
      expect(mockDispatch).toHaveBeenCalledWith('pause_animation', { entityId: 'ent-1' });
    });

    it('resumeAnimation dispatches', () => {
      store.getState().resumeAnimation('ent-1');
      expect(mockDispatch).toHaveBeenCalledWith('resume_animation', { entityId: 'ent-1' });
    });

    it('stopAnimation dispatches', () => {
      store.getState().stopAnimation('ent-1');
      expect(mockDispatch).toHaveBeenCalledWith('stop_animation', { entityId: 'ent-1' });
    });

    it('seekAnimation dispatches time', () => {
      store.getState().seekAnimation('ent-1', 1.5);
      expect(mockDispatch).toHaveBeenCalledWith('seek_animation', { entityId: 'ent-1', timeSecs: 1.5 });
    });

    it('setAnimationSpeed dispatches', () => {
      store.getState().setAnimationSpeed('ent-1', 2.0);
      expect(mockDispatch).toHaveBeenCalledWith('set_animation_speed', { entityId: 'ent-1', speed: 2.0 });
    });

    it('setAnimationLoop dispatches', () => {
      store.getState().setAnimationLoop('ent-1', false);
      expect(mockDispatch).toHaveBeenCalledWith('set_animation_loop', { entityId: 'ent-1', looping: false });
    });

    it('setAnimationBlendWeight dispatches', () => {
      store.getState().setAnimationBlendWeight('ent-1', 'walk', 0.7);
      expect(mockDispatch).toHaveBeenCalledWith('set_animation_blend_weight', {
        entityId: 'ent-1', clipName: 'walk', weight: 0.7,
      });
    });

    it('setClipSpeed dispatches', () => {
      store.getState().setClipSpeed('ent-1', 'walk', 1.5);
      expect(mockDispatch).toHaveBeenCalledWith('set_clip_speed', {
        entityId: 'ent-1', clipName: 'walk', speed: 1.5,
      });
    });
  });

  describe('Primary animation state', () => {
    const sampleState = {
      entityId: 'ent-1',
      availableClips: [
        { name: 'idle', nodeIndex: 0, durationSecs: 1.0 },
        { name: 'walk', nodeIndex: 1, durationSecs: 0.8 },
        { name: 'run', nodeIndex: 2, durationSecs: 0.6 },
      ],
      activeClipName: 'idle',
      activeNodeIndex: 0,
      isPlaying: true,
      isPaused: false,
      elapsedSecs: 0,
      speed: 1.0,
      isLooping: true,
      isFinished: false,
    };

    it('setPrimaryAnimation sets state only', () => {
      store.getState().setPrimaryAnimation(sampleState);
      expect(store.getState().primaryAnimation).toEqual(sampleState);
      expect(mockDispatch).not.toHaveBeenCalled();
    });

    it('setEntityAnimation updates state', () => {
      store.getState().setEntityAnimation('ent-1', sampleState);
      expect(store.getState().primaryAnimation).toEqual(sampleState);
      expect(mockDispatch).not.toHaveBeenCalled();
    });
  });

  describe('Animation clips', () => {
    it('createAnimationClip dispatches with undefined defaults', () => {
      store.getState().createAnimationClip('ent-1');
      expect(mockDispatch).toHaveBeenCalledWith('create_animation_clip', {
        entityId: 'ent-1', duration: undefined, playMode: undefined,
      });
    });

    it('createAnimationClip dispatches with custom values', () => {
      store.getState().createAnimationClip('ent-1', 5.0, 'loop');
      expect(mockDispatch).toHaveBeenCalledWith('create_animation_clip', {
        entityId: 'ent-1', duration: 5.0, playMode: 'loop',
      });
    });

    it('addClipKeyframe dispatches', () => {
      store.getState().addClipKeyframe('ent-1', 'position.x', 0.5, 3.0);
      expect(mockDispatch).toHaveBeenCalledWith('add_clip_keyframe', {
        entityId: 'ent-1', target: 'position.x', time: 0.5, value: 3.0, interpolation: undefined,
      });
    });

    it('removeClipKeyframe dispatches', () => {
      store.getState().removeClipKeyframe('ent-1', 'position.x', 0.5);
      expect(mockDispatch).toHaveBeenCalledWith('remove_clip_keyframe', {
        entityId: 'ent-1', target: 'position.x', time: 0.5,
      });
    });

    it('updateClipKeyframe dispatches partial', () => {
      store.getState().updateClipKeyframe('ent-1', 'rotation.y', 1.0, 90.0, 'ease_in');
      expect(mockDispatch).toHaveBeenCalledWith('update_clip_keyframe', {
        entityId: 'ent-1', target: 'rotation.y', time: 1.0, value: 90.0, interpolation: 'ease_in', newTime: undefined,
      });
    });

    it('setClipProperty dispatches', () => {
      store.getState().setClipProperty('ent-1', 3.0, 'loop', 1.5, true);
      expect(mockDispatch).toHaveBeenCalledWith('set_clip_property', {
        entityId: 'ent-1', duration: 3.0, playMode: 'loop', speed: 1.5, autoplay: true,
      });
    });

    it('previewClip dispatches play action', () => {
      store.getState().previewClip('ent-1', 'play');
      expect(mockDispatch).toHaveBeenCalledWith('preview_clip', {
        entityId: 'ent-1', action: 'play', seekTime: undefined,
      });
    });

    it('removeAnimationClip dispatches', () => {
      store.getState().removeAnimationClip('ent-1');
      expect(mockDispatch).toHaveBeenCalledWith('remove_animation_clip', {
        entityId: 'ent-1',
      });
    });
  });

  describe('2D Skeletons', () => {
    const sampleSkeleton = {
      bones: [{ name: 'root', parentBone: null, localPosition: [0, 0] as [number, number], localRotation: 0, localScale: [1, 1] as [number, number], length: 50, color: [1, 1, 1, 1] as [number, number, number, number] }],
      slots: [],
      skins: { default: { name: 'default', attachments: {} } },
      activeSkin: 'default',
      ikConstraints: [],
    };

    it('setSkeleton2d stores and dispatches', () => {
      store.getState().setSkeleton2d('ent-1', sampleSkeleton);
      expect(store.getState().skeletons2d['ent-1']).toEqual(sampleSkeleton);
      expect(mockDispatch).toHaveBeenCalledWith('set_skeleton_2d', {
        entityId: 'ent-1', ...sampleSkeleton,
      });
    });

    it('removeSkeleton2d removes and dispatches', () => {
      store.getState().setSkeleton2d('ent-1', sampleSkeleton);
      store.getState().removeSkeleton2d('ent-1');
      expect(store.getState().skeletons2d['ent-1']).toBeUndefined();
    });

    it('setSkeletalAnimations2d stores animations', () => {
      const anims = [{ name: 'walk', duration: 1.0, looping: true, tracks: {} }];
      store.getState().setSkeletalAnimations2d('ent-1', anims);
      expect(store.getState().skeletalAnimations2d['ent-1']).toEqual(anims);
      expect(mockDispatch).not.toHaveBeenCalled();
    });

    it('setSelectedBone changes selection', () => {
      store.getState().setSelectedBone('root');
      expect(store.getState().selectedBone).toBe('root');
      store.getState().setSelectedBone(null);
      expect(store.getState().selectedBone).toBeNull();
    });
  });
});
