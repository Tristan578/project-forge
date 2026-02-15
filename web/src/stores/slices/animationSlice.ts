/**
 * Animation slice - manages 3D skeletal animation, keyframe clips, and 2D skeletal animation.
 * TODO: Extract full implementation from editorStore.ts
 */

import { StateCreator } from 'zustand';
import type { AnimationPlaybackState, AnimationClipData, SkeletonData2d, SkeletalAnimation2d } from './types';

export interface AnimationSlice {
  primaryAnimation: AnimationPlaybackState | null;
  primaryAnimationClip: AnimationClipData | null;
  skeletons2d: Record<string, SkeletonData2d>;
  skeletalAnimations2d: Record<string, SkeletalAnimation2d[]>;
  selectedBone: string | null;

  playAnimation: (entityId: string, clipName: string, crossfadeSecs?: number) => void;
  pauseAnimation: (entityId: string) => void;
  resumeAnimation: (entityId: string) => void;
  stopAnimation: (entityId: string) => void;
  seekAnimation: (entityId: string, timeSecs: number) => void;
  setAnimationSpeed: (entityId: string, speed: number) => void;
  setAnimationLoop: (entityId: string, looping: boolean) => void;
  setAnimationBlendWeight: (entityId: string, clipName: string, weight: number) => void;
  setClipSpeed: (entityId: string, clipName: string, speed: number) => void;
  setEntityAnimation: (entityId: string, state: AnimationPlaybackState | null) => void;
  setPrimaryAnimation: (state: AnimationPlaybackState | null) => void;
  createAnimationClip: (entityId: string, duration?: number, playMode?: string) => void;
  addClipKeyframe: (entityId: string, target: string, time: number, value: number, interpolation?: string) => void;
  removeClipKeyframe: (entityId: string, target: string, time: number) => void;
  updateClipKeyframe: (entityId: string, target: string, time: number, value?: number, interpolation?: string, newTime?: number) => void;
  setClipProperty: (entityId: string, duration?: number, playMode?: string, speed?: number, autoplay?: boolean) => void;
  previewClip: (entityId: string, action: 'play' | 'stop' | 'seek', seekTime?: number) => void;
  removeAnimationClip: (entityId: string) => void;
  setSkeleton2d: (entityId: string, data: SkeletonData2d) => void;
  removeSkeleton2d: (entityId: string) => void;
  setSkeletalAnimations2d: (entityId: string, animations: SkeletalAnimation2d[]) => void;
  setSelectedBone: (boneName: string | null) => void;
}

let dispatchCommand: ((command: string, payload: unknown) => void) | null = null;

export function setAnimationDispatcher(dispatcher: (command: string, payload: unknown) => void): void {
  dispatchCommand = dispatcher;
}

export const createAnimationSlice: StateCreator<AnimationSlice, [], [], AnimationSlice> = (set) => ({
  primaryAnimation: null,
  primaryAnimationClip: null,
  skeletons2d: {},
  skeletalAnimations2d: {},
  selectedBone: null,

  playAnimation: (entityId, clipName, crossfadeSecs) => {
    if (dispatchCommand) dispatchCommand('play_animation', { entityId, clipName, crossfadeSecs });
  },
  pauseAnimation: (entityId) => {
    if (dispatchCommand) dispatchCommand('pause_animation', { entityId });
  },
  resumeAnimation: (entityId) => {
    if (dispatchCommand) dispatchCommand('resume_animation', { entityId });
  },
  stopAnimation: (entityId) => {
    if (dispatchCommand) dispatchCommand('stop_animation', { entityId });
  },
  seekAnimation: (entityId, timeSecs) => {
    if (dispatchCommand) dispatchCommand('seek_animation', { entityId, timeSecs });
  },
  setAnimationSpeed: (entityId, speed) => {
    if (dispatchCommand) dispatchCommand('set_animation_speed', { entityId, speed });
  },
  setAnimationLoop: (entityId, looping) => {
    if (dispatchCommand) dispatchCommand('set_animation_loop', { entityId, looping });
  },
  setAnimationBlendWeight: (entityId, clipName, weight) => {
    if (dispatchCommand) dispatchCommand('set_animation_blend_weight', { entityId, clipName, weight });
  },
  setClipSpeed: (entityId, clipName, speed) => {
    if (dispatchCommand) dispatchCommand('set_clip_speed', { entityId, clipName, speed });
  },
  setEntityAnimation: (_entityId, state) => set({ primaryAnimation: state }),
  setPrimaryAnimation: (state) => set({ primaryAnimation: state }),
  createAnimationClip: (entityId, duration, playMode) => {
    if (dispatchCommand) dispatchCommand('create_animation_clip', { entityId, duration, playMode });
  },
  addClipKeyframe: (entityId, target, time, value, interpolation) => {
    if (dispatchCommand) dispatchCommand('add_clip_keyframe', { entityId, target, time, value, interpolation });
  },
  removeClipKeyframe: (entityId, target, time) => {
    if (dispatchCommand) dispatchCommand('remove_clip_keyframe', { entityId, target, time });
  },
  updateClipKeyframe: (entityId, target, time, value, interpolation, newTime) => {
    if (dispatchCommand) dispatchCommand('update_clip_keyframe', { entityId, target, time, value, interpolation, newTime });
  },
  setClipProperty: (entityId, duration, playMode, speed, autoplay) => {
    if (dispatchCommand) dispatchCommand('set_clip_property', { entityId, duration, playMode, speed, autoplay });
  },
  previewClip: (entityId, action, seekTime) => {
    if (dispatchCommand) dispatchCommand('preview_clip', { entityId, action, seekTime });
  },
  removeAnimationClip: (entityId) => {
    if (dispatchCommand) dispatchCommand('remove_animation_clip', { entityId });
  },
  setSkeleton2d: (entityId, data) => {
    set(state => ({ skeletons2d: { ...state.skeletons2d, [entityId]: data } }));
    if (dispatchCommand) dispatchCommand('set_skeleton_2d', { entityId, ...data });
  },
  removeSkeleton2d: (entityId) => {
    set(state => {
      const { [entityId]: _, ...rest } = state.skeletons2d;
      return { skeletons2d: rest };
    });
    if (dispatchCommand) dispatchCommand('remove_skeleton_2d', { entityId });
  },
  setSkeletalAnimations2d: (entityId, animations) => {
    set(state => ({ skeletalAnimations2d: { ...state.skeletalAnimations2d, [entityId]: animations } }));
  },
  setSelectedBone: (boneName) => set({ selectedBone: boneName }),
});
