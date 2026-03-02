import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createSliceStore, createMockDispatch } from './sliceTestTemplate';
import { createAnimationSlice, setAnimationDispatcher, type AnimationSlice } from '../animationSlice';
import type { AnimationPlaybackState, SkeletonData2d, SkeletalAnimation2d } from '../types';

let store: ReturnType<typeof createSliceStore<AnimationSlice>>;
let mockDispatch: ReturnType<typeof createMockDispatch>;

beforeEach(() => {
  store = createSliceStore(createAnimationSlice);
  mockDispatch = createMockDispatch();
  setAnimationDispatcher(mockDispatch);
});

afterEach(() => {
  setAnimationDispatcher(null as unknown as (command: string, payload: unknown) => void);
});

describe('animationSlice', () => {
  describe('initial state', () => {
    it('should have null primaryAnimation', () => {
      expect(store.getState().primaryAnimation).toBeNull();
    });

    it('should have null primaryAnimationClip', () => {
      expect(store.getState().primaryAnimationClip).toBeNull();
    });

    it('should have empty skeletons2d', () => {
      expect(store.getState().skeletons2d).toEqual({});
    });

    it('should have empty skeletalAnimations2d', () => {
      expect(store.getState().skeletalAnimations2d).toEqual({});
    });

    it('should have null selectedBone', () => {
      expect(store.getState().selectedBone).toBeNull();
    });
  });

  describe('3D animation playback commands', () => {
    it('playAnimation should dispatch with optional crossfade', () => {
      store.getState().playAnimation('entity1', 'walk', 0.3);

      expect(mockDispatch).toHaveBeenCalledWith('play_animation', {
        entityId: 'entity1',
        clipName: 'walk',
        crossfadeSecs: 0.3,
      });
    });

    it('playAnimation should dispatch without crossfade', () => {
      store.getState().playAnimation('entity1', 'idle');

      expect(mockDispatch).toHaveBeenCalledWith('play_animation', {
        entityId: 'entity1',
        clipName: 'idle',
        crossfadeSecs: undefined,
      });
    });

    it('pauseAnimation should dispatch', () => {
      store.getState().pauseAnimation('entity1');

      expect(mockDispatch).toHaveBeenCalledWith('pause_animation', {
        entityId: 'entity1',
      });
    });

    it('resumeAnimation should dispatch', () => {
      store.getState().resumeAnimation('entity1');

      expect(mockDispatch).toHaveBeenCalledWith('resume_animation', {
        entityId: 'entity1',
      });
    });

    it('stopAnimation should dispatch', () => {
      store.getState().stopAnimation('entity1');

      expect(mockDispatch).toHaveBeenCalledWith('stop_animation', {
        entityId: 'entity1',
      });
    });

    it('seekAnimation should dispatch', () => {
      store.getState().seekAnimation('entity1', 2.5);

      expect(mockDispatch).toHaveBeenCalledWith('seek_animation', {
        entityId: 'entity1',
        timeSecs: 2.5,
      });
    });

    it('setAnimationSpeed should dispatch', () => {
      store.getState().setAnimationSpeed('entity1', 1.5);

      expect(mockDispatch).toHaveBeenCalledWith('set_animation_speed', {
        entityId: 'entity1',
        speed: 1.5,
      });
    });

    it('setAnimationLoop should dispatch', () => {
      store.getState().setAnimationLoop('entity1', true);

      expect(mockDispatch).toHaveBeenCalledWith('set_animation_loop', {
        entityId: 'entity1',
        looping: true,
      });
    });

    it('setAnimationBlendWeight should dispatch', () => {
      store.getState().setAnimationBlendWeight('entity1', 'walk', 0.7);

      expect(mockDispatch).toHaveBeenCalledWith('set_animation_blend_weight', {
        entityId: 'entity1',
        clipName: 'walk',
        weight: 0.7,
      });
    });

    it('setClipSpeed should dispatch', () => {
      store.getState().setClipSpeed('entity1', 'run', 2.0);

      expect(mockDispatch).toHaveBeenCalledWith('set_clip_speed', {
        entityId: 'entity1',
        clipName: 'run',
        speed: 2.0,
      });
    });
  });

  describe('animation state setters', () => {
    it('setEntityAnimation should set primaryAnimation (state only)', () => {
      const state = { clipName: 'idle', playing: true } as unknown as AnimationPlaybackState;
      store.getState().setEntityAnimation('entity1', state);

      expect(store.getState().primaryAnimation).toEqual(state);
      expect(mockDispatch).not.toHaveBeenCalled();
    });

    it('setEntityAnimation should clear with null', () => {
      const state = { clipName: 'idle' } as unknown as AnimationPlaybackState;
      store.getState().setEntityAnimation('entity1', state);
      store.getState().setEntityAnimation('entity1', null);

      expect(store.getState().primaryAnimation).toBeNull();
    });

    it('setPrimaryAnimation should set state only', () => {
      const state = { clipName: 'walk' } as unknown as AnimationPlaybackState;
      store.getState().setPrimaryAnimation(state);

      expect(store.getState().primaryAnimation).toEqual(state);
      expect(mockDispatch).not.toHaveBeenCalled();
    });
  });

  describe('animation clip commands', () => {
    it('createAnimationClip should dispatch', () => {
      store.getState().createAnimationClip('entity1', 5.0, 'loop');

      expect(mockDispatch).toHaveBeenCalledWith('create_animation_clip', {
        entityId: 'entity1',
        duration: 5.0,
        playMode: 'loop',
      });
    });

    it('createAnimationClip should dispatch with undefined optional params', () => {
      store.getState().createAnimationClip('entity1');

      expect(mockDispatch).toHaveBeenCalledWith('create_animation_clip', {
        entityId: 'entity1',
        duration: undefined,
        playMode: undefined,
      });
    });

    it('addClipKeyframe should dispatch', () => {
      store.getState().addClipKeyframe('entity1', 'position.x', 1.0, 5.0, 'linear');

      expect(mockDispatch).toHaveBeenCalledWith('add_clip_keyframe', {
        entityId: 'entity1',
        target: 'position.x',
        time: 1.0,
        value: 5.0,
        interpolation: 'linear',
      });
    });

    it('removeClipKeyframe should dispatch', () => {
      store.getState().removeClipKeyframe('entity1', 'position.x', 1.0);

      expect(mockDispatch).toHaveBeenCalledWith('remove_clip_keyframe', {
        entityId: 'entity1',
        target: 'position.x',
        time: 1.0,
      });
    });

    it('updateClipKeyframe should dispatch with all params', () => {
      store.getState().updateClipKeyframe('entity1', 'rotation.z', 2.0, 90.0, 'ease_in', 2.5);

      expect(mockDispatch).toHaveBeenCalledWith('update_clip_keyframe', {
        entityId: 'entity1',
        target: 'rotation.z',
        time: 2.0,
        value: 90.0,
        interpolation: 'ease_in',
        newTime: 2.5,
      });
    });

    it('setClipProperty should dispatch', () => {
      store.getState().setClipProperty('entity1', 3.0, 'once', 1.5, true);

      expect(mockDispatch).toHaveBeenCalledWith('set_clip_property', {
        entityId: 'entity1',
        duration: 3.0,
        playMode: 'once',
        speed: 1.5,
        autoplay: true,
      });
    });

    it('previewClip should dispatch play action', () => {
      store.getState().previewClip('entity1', 'play');

      expect(mockDispatch).toHaveBeenCalledWith('preview_clip', {
        entityId: 'entity1',
        action: 'play',
        seekTime: undefined,
      });
    });

    it('previewClip should dispatch seek with time', () => {
      store.getState().previewClip('entity1', 'seek', 1.5);

      expect(mockDispatch).toHaveBeenCalledWith('preview_clip', {
        entityId: 'entity1',
        action: 'seek',
        seekTime: 1.5,
      });
    });

    it('removeAnimationClip should dispatch', () => {
      store.getState().removeAnimationClip('entity1');

      expect(mockDispatch).toHaveBeenCalledWith('remove_animation_clip', {
        entityId: 'entity1',
      });
    });
  });

  describe('2D skeleton operations', () => {
    it('setSkeleton2d should update state and dispatch', () => {
      const data: SkeletonData2d = {
        bones: [
          {
            name: 'root',
            parentBone: null,
            localPosition: [0, 0],
            localRotation: 0,
            localScale: [1, 1],
            length: 50,
            color: [1, 1, 1, 1],
          },
        ],
        slots: [],
        skins: {},
        activeSkin: 'default',
        ikConstraints: [],
      };
      store.getState().setSkeleton2d('entity1', data);

      expect(store.getState().skeletons2d.entity1).toEqual(data);
      expect(mockDispatch).toHaveBeenCalledWith('set_skeleton_2d', {
        entityId: 'entity1',
        ...data,
      });
    });

    it('setSkeleton2d should handle multiple entities', () => {
      const data1 = { bones: [{ name: 'root' }] } as unknown as SkeletonData2d;
      const data2 = { bones: [{ name: 'spine' }] } as unknown as SkeletonData2d;
      store.getState().setSkeleton2d('entity1', data1);
      store.getState().setSkeleton2d('entity2', data2);

      expect(store.getState().skeletons2d.entity1).toEqual(data1);
      expect(store.getState().skeletons2d.entity2).toEqual(data2);
    });

    it('setSkeleton2d should overwrite existing skeleton for same entity', () => {
      const data1 = { bones: [{ name: 'root' }] } as unknown as SkeletonData2d;
      const data2 = { bones: [{ name: 'root' }, { name: 'spine' }] } as unknown as SkeletonData2d;
      store.getState().setSkeleton2d('entity1', data1);
      store.getState().setSkeleton2d('entity1', data2);

      expect(store.getState().skeletons2d.entity1).toEqual(data2);
    });

    it('removeSkeleton2d should remove from map and dispatch', () => {
      const data = { bones: [] } as unknown as SkeletonData2d;
      store.getState().setSkeleton2d('entity1', data);

      store.getState().removeSkeleton2d('entity1');

      expect(store.getState().skeletons2d.entity1).toBeUndefined();
      expect(mockDispatch).toHaveBeenCalledWith('remove_skeleton_2d', {
        entityId: 'entity1',
      });
    });

    it('removeSkeleton2d should not affect other entities', () => {
      const data1 = { bones: [] } as unknown as SkeletonData2d;
      const data2 = { bones: [] } as unknown as SkeletonData2d;
      store.getState().setSkeleton2d('entity1', data1);
      store.getState().setSkeleton2d('entity2', data2);

      store.getState().removeSkeleton2d('entity1');

      expect(store.getState().skeletons2d.entity1).toBeUndefined();
      expect(store.getState().skeletons2d.entity2).toEqual(data2);
    });
  });

  describe('2D skeletal animations', () => {
    it('setSkeletalAnimations2d should update state (no dispatch)', () => {
      const anims = [
        { name: 'walk', keyframes: [] },
        { name: 'idle', keyframes: [] },
      ] as unknown as SkeletalAnimation2d[];
      store.getState().setSkeletalAnimations2d('entity1', anims);

      expect(store.getState().skeletalAnimations2d.entity1).toEqual(anims);
      expect(mockDispatch).not.toHaveBeenCalled();
    });

    it('setSkeletalAnimations2d should handle multiple entities', () => {
      const anims1 = [{ name: 'walk' }] as unknown as SkeletalAnimation2d[];
      const anims2 = [{ name: 'run' }] as unknown as SkeletalAnimation2d[];
      store.getState().setSkeletalAnimations2d('entity1', anims1);
      store.getState().setSkeletalAnimations2d('entity2', anims2);

      expect(store.getState().skeletalAnimations2d.entity1).toEqual(anims1);
      expect(store.getState().skeletalAnimations2d.entity2).toEqual(anims2);
    });

    it('setSkeletalAnimations2d should overwrite existing animations for an entity', () => {
      const anims1 = [{ name: 'walk' }] as unknown as SkeletalAnimation2d[];
      const anims2 = [{ name: 'walk' }, { name: 'run' }] as unknown as SkeletalAnimation2d[];
      store.getState().setSkeletalAnimations2d('entity1', anims1);
      store.getState().setSkeletalAnimations2d('entity1', anims2);

      expect(store.getState().skeletalAnimations2d.entity1).toEqual(anims2);
      expect(store.getState().skeletalAnimations2d.entity1).toHaveLength(2);
    });

    it('setSkeletalAnimations2d should accept an empty array', () => {
      store.getState().setSkeletalAnimations2d('entity1', []);

      expect(store.getState().skeletalAnimations2d.entity1).toEqual([]);
    });
  });

  describe('bone selection', () => {
    it('setSelectedBone should set bone name', () => {
      store.getState().setSelectedBone('spine');

      expect(store.getState().selectedBone).toBe('spine');
      expect(mockDispatch).not.toHaveBeenCalled();
    });

    it('setSelectedBone should clear with null', () => {
      store.getState().setSelectedBone('spine');
      store.getState().setSelectedBone(null);

      expect(store.getState().selectedBone).toBeNull();
    });
  });
});
