/**
 * Event handlers for animations, animation clips, skeleton2d.
 */

import { useEditorStore, type AnimationPlaybackState, type AnimationClipData } from '@/stores/editorStore';
import { castPayload, type SetFn, type GetFn } from './types';

export function handleAnimationEvent(
  type: string,
  data: Record<string, unknown>,
  _set: SetFn,
  _get: GetFn
): boolean {
  switch (type) {
    case 'ANIMATION_STATE_CHANGED': {
      const animState = castPayload<AnimationPlaybackState>(data);
      useEditorStore.getState().setEntityAnimation(animState.entityId, animState);
      return true;
    }

    case 'ANIMATION_LIST_CHANGED': {
      const animState = castPayload<AnimationPlaybackState>(data);
      useEditorStore.getState().setEntityAnimation(animState.entityId, animState);
      return true;
    }

    case 'ANIMATION_CLIP_CHANGED': {
      const clipPayload = castPayload<AnimationClipData & { entityId: string }>(data);
      const state = useEditorStore.getState();
      if (state.primaryId === clipPayload.entityId) {
        const { entityId: _entityId, ...clipData } = clipPayload;
        useEditorStore.setState({ primaryAnimationClip: clipData });
      }
      return true;
    }

    case 'SKELETON2D_UPDATED': {
      const payload = castPayload<{ entityId: string; skeleton: import('@/stores/editorStore').SkeletonData2d }>(data);
      useEditorStore.getState().setSkeleton2d(payload.entityId, payload.skeleton);
      return true;
    }

    case 'SKELETAL_ANIMATION2D_PLAYING': {
      // Animation playback state could be tracked here if needed
      return true;
    }

    case 'SKELETON2D_SKIN_CHANGED': {
      const payload = castPayload<{ entityId: string; skinName: string }>(data);
      const skeleton = useEditorStore.getState().skeletons2d[payload.entityId];
      if (skeleton) {
        useEditorStore.getState().setSkeleton2d(payload.entityId, {
          ...skeleton,
          activeSkin: payload.skinName
        });
      }
      return true;
    }

    default:
      return false;
  }
}
