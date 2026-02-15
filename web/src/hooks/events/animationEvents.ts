/**
 * Event handlers for animations, animation clips, skeleton2d.
 */

import { useEditorStore, type AnimationPlaybackState, type AnimationClipData } from '@/stores/editorStore';
import type { SetFn, GetFn } from './types';

export function handleAnimationEvent(
  type: string,
  data: Record<string, unknown>,
  _set: SetFn,
  _get: GetFn
): boolean {
  switch (type) {
    case 'ANIMATION_STATE_CHANGED': {
      const animState = data as unknown as AnimationPlaybackState;
      useEditorStore.getState().setEntityAnimation(animState.entityId, animState);
      return true;
    }

    case 'ANIMATION_LIST_CHANGED': {
      const animState = data as unknown as AnimationPlaybackState;
      useEditorStore.getState().setEntityAnimation(animState.entityId, animState);
      return true;
    }

    case 'ANIMATION_CLIP_CHANGED': {
      const clipPayload = data as unknown as AnimationClipData & { entityId: string };
      const state = useEditorStore.getState();
      if (state.primaryId === clipPayload.entityId) {
        const { entityId: _entityId, ...clipData } = clipPayload;
        useEditorStore.setState({ primaryAnimationClip: clipData });
      }
      return true;
    }

    case 'SKELETON2D_UPDATED': {
      const payload = data as unknown as { entityId: string; skeleton: import('@/stores/editorStore').SkeletonData2d };
      useEditorStore.getState().setSkeleton2d(payload.entityId, payload.skeleton);
      return true;
    }

    case 'SKELETAL_ANIMATION2D_PLAYING': {
      // Animation playback state could be tracked here if needed
      return true;
    }

    case 'SKELETON2D_SKIN_CHANGED': {
      const payload = data as unknown as { entityId: string; skinName: string };
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
