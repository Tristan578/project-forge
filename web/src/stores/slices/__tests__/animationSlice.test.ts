import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createSliceStore, createMockDispatch } from './sliceTestTemplate';
import { createAnimationSlice, setAnimationDispatcher, type AnimationSlice } from '../animationSlice';

describe('animationSlice', () => {
  let store: ReturnType<typeof createSliceStore<AnimationSlice>>;
  let mockDispatch: ReturnType<typeof createMockDispatch>;

  beforeEach(() => {
    mockDispatch = createMockDispatch();
    setAnimationDispatcher(mockDispatch);
    store = createSliceStore(createAnimationSlice);
  });

  afterEach(() => {
    setAnimationDispatcher(null as unknown as (command: string, payload: unknown) => void);
  });

  describe('Initial state', () => {
    it('should start with null animations and empty collections', () => {
      expect(store.getState().primaryAnimation).toBeNull();
      expect(store.getState().primaryAnimationClip).toBeNull();
      expect(store.getState().skeletons2d).toEqual({});
      expect(store.getState().skeletalAnimations2d).toEqual({});
      expect(store.getState().selectedBone).toBeNull();
    });
  });

  describe('playback commands', () => {
    it('playAnimation should dispatch with crossfade', () => {
      store.getState().playAnimation('ent-1', 'walk', 0.3);
      expect(mockDispatch).toHaveBeenCalledWith('play_animation', {
        entityId: 'ent-1',
        clipName: 'walk',
        crossfadeSecs: 0.3,
      });
    });

    it('playAnimation should dispatch without crossfade', () => {
      store.getState().playAnimation('ent-1', 'idle');
      expect(mockDispatch).toHaveBeenCalledWith('play_animation', {
        entityId: 'ent-1',
        clipName: 'idle',
        crossfadeSecs: undefined,
      });
    });

    it('pauseAnimation should dispatch', () => {
      store.getState().pauseAnimation('ent-1');
      expect(mockDispatch).toHaveBeenCalledWith('pause_animation', { entityId: 'ent-1' });
    });

    it('resumeAnimation should dispatch', () => {
      store.getState().resumeAnimation('ent-1');
      expect(mockDispatch).toHaveBeenCalledWith('resume_animation', { entityId: 'ent-1' });
    });

    it('stopAnimation should dispatch', () => {
      store.getState().stopAnimation('ent-1');
      expect(mockDispatch).toHaveBeenCalledWith('stop_animation', { entityId: 'ent-1' });
    });

    it('seekAnimation should dispatch', () => {
      store.getState().seekAnimation('ent-1', 2.5);
      expect(mockDispatch).toHaveBeenCalledWith('seek_animation', { entityId: 'ent-1', timeSecs: 2.5 });
    });
  });

  describe('animation properties', () => {
    it('setAnimationSpeed should dispatch', () => {
      store.getState().setAnimationSpeed('ent-1', 2.0);
      expect(mockDispatch).toHaveBeenCalledWith('set_animation_speed', { entityId: 'ent-1', speed: 2.0 });
    });

    it('setAnimationLoop should dispatch', () => {
      store.getState().setAnimationLoop('ent-1', true);
      expect(mockDispatch).toHaveBeenCalledWith('set_animation_loop', { entityId: 'ent-1', looping: true });
    });

    it('setAnimationBlendWeight should dispatch', () => {
      store.getState().setAnimationBlendWeight('ent-1', 'walk', 0.7);
      expect(mockDispatch).toHaveBeenCalledWith('set_animation_blend_weight', {
        entityId: 'ent-1',
        clipName: 'walk',
        weight: 0.7,
      });
    });

    it('setClipSpeed should dispatch', () => {
      store.getState().setClipSpeed('ent-1', 'run', 1.5);
      expect(mockDispatch).toHaveBeenCalledWith('set_clip_speed', {
        entityId: 'ent-1',
        clipName: 'run',
        speed: 1.5,
      });
    });
  });

  describe('state setters', () => {
    it('setEntityAnimation should set primaryAnimation', () => {
      const state = { playing: true, clipName: 'walk', time: 0 };
      store.getState().setEntityAnimation('ent-1', state as never);
      expect(store.getState().primaryAnimation).toEqual(state);
    });

    it('setEntityAnimation should clear with null', () => {
      store.getState().setEntityAnimation('ent-1', { playing: true } as never);
      store.getState().setEntityAnimation('ent-1', null);
      expect(store.getState().primaryAnimation).toBeNull();
    });

    it('setPrimaryAnimation should set state', () => {
      const state = { playing: false, clipName: 'idle', time: 1.5 };
      store.getState().setPrimaryAnimation(state as never);
      expect(store.getState().primaryAnimation).toEqual(state);
    });
  });

  describe('animation clip commands', () => {
    it('createAnimationClip should dispatch', () => {
      store.getState().createAnimationClip('ent-1', 5.0, 'loop');
      expect(mockDispatch).toHaveBeenCalledWith('create_animation_clip', {
        entityId: 'ent-1',
        duration: 5.0,
        playMode: 'loop',
      });
    });

    it('addClipKeyframe should dispatch', () => {
      store.getState().addClipKeyframe('ent-1', 'position.x', 0.5, 10.0, 'linear');
      expect(mockDispatch).toHaveBeenCalledWith('add_clip_keyframe', {
        entityId: 'ent-1',
        target: 'position.x',
        time: 0.5,
        value: 10.0,
        interpolation: 'linear',
      });
    });

    it('removeClipKeyframe should dispatch', () => {
      store.getState().removeClipKeyframe('ent-1', 'position.x', 0.5);
      expect(mockDispatch).toHaveBeenCalledWith('remove_clip_keyframe', {
        entityId: 'ent-1',
        target: 'position.x',
        time: 0.5,
      });
    });

    it('updateClipKeyframe should dispatch', () => {
      store.getState().updateClipKeyframe('ent-1', 'rotation.y', 1.0, 90.0, 'ease', 1.5);
      expect(mockDispatch).toHaveBeenCalledWith('update_clip_keyframe', {
        entityId: 'ent-1',
        target: 'rotation.y',
        time: 1.0,
        value: 90.0,
        interpolation: 'ease',
        newTime: 1.5,
      });
    });

    it('setClipProperty should dispatch', () => {
      store.getState().setClipProperty('ent-1', 10.0, 'ping_pong', 0.5, true);
      expect(mockDispatch).toHaveBeenCalledWith('set_clip_property', {
        entityId: 'ent-1',
        duration: 10.0,
        playMode: 'ping_pong',
        speed: 0.5,
        autoplay: true,
      });
    });

    it('previewClip should dispatch play', () => {
      store.getState().previewClip('ent-1', 'play');
      expect(mockDispatch).toHaveBeenCalledWith('preview_clip', {
        entityId: 'ent-1',
        action: 'play',
        seekTime: undefined,
      });
    });

    it('previewClip should dispatch seek with time', () => {
      store.getState().previewClip('ent-1', 'seek', 3.0);
      expect(mockDispatch).toHaveBeenCalledWith('preview_clip', {
        entityId: 'ent-1',
        action: 'seek',
        seekTime: 3.0,
      });
    });

    it('removeAnimationClip should dispatch', () => {
      store.getState().removeAnimationClip('ent-1');
      expect(mockDispatch).toHaveBeenCalledWith('remove_animation_clip', { entityId: 'ent-1' });
    });
  });

  describe('2D skeleton management', () => {
    it('setSkeleton2d should store data and dispatch', () => {
      const data = { bones: [{ name: 'root', parent: null }] };
      store.getState().setSkeleton2d('ent-1', data as never);

      expect(store.getState().skeletons2d['ent-1']).toEqual(data);
      expect(mockDispatch).toHaveBeenCalledWith('set_skeleton_2d', { entityId: 'ent-1', ...data });
    });

    it('removeSkeleton2d should remove data and dispatch', () => {
      store.getState().setSkeleton2d('ent-1', { bones: [] } as never);
      store.getState().removeSkeleton2d('ent-1');

      expect(store.getState().skeletons2d['ent-1']).toBeUndefined();
      expect(mockDispatch).toHaveBeenCalledWith('remove_skeleton_2d', { entityId: 'ent-1' });
    });

    it('removeSkeleton2d should not affect other entities', () => {
      store.getState().setSkeleton2d('ent-1', { bones: ['a'] } as never);
      store.getState().setSkeleton2d('ent-2', { bones: ['b'] } as never);
      store.getState().removeSkeleton2d('ent-1');

      expect(store.getState().skeletons2d['ent-2']).toBeDefined();
    });

    it('setSkeletalAnimations2d should store animations', () => {
      const anims = [{ name: 'walk', frames: 10 }];
      store.getState().setSkeletalAnimations2d('ent-1', anims as never);
      expect(store.getState().skeletalAnimations2d['ent-1']).toEqual(anims);
    });
  });

  describe('bone selection', () => {
    it('should set selected bone', () => {
      store.getState().setSelectedBone('arm_left');
      expect(store.getState().selectedBone).toBe('arm_left');
    });

    it('should clear selected bone', () => {
      store.getState().setSelectedBone('arm_left');
      store.getState().setSelectedBone(null);
      expect(store.getState().selectedBone).toBeNull();
    });
  });
});
