/**
 * Event handlers for animations, animation clips, skeleton2d.
 */

import { useEditorStore, type AnimationPlaybackState, type AnimationClipData } from '@/stores/editorStore';
import { parseSkeletonWire2d } from '@/lib/skeleton2d/skeletonPayload';
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

    // `emit_skeleton2d_updated` sends `{ entityId, data, enabled }` — the rig is
    // under `data`, and it is the engine's `SkeletonData2d` wire shape, not the
    // store's. Reading the wrong key yielded `undefined`, which
    // `buildWireSkeletonData2d` then coerced into a valid-but-empty rig and
    // `setSkeleton2d` dispatched straight back as a full-replace
    // `create_skeleton2d` — so Apply Rig destroyed the rig it had just applied,
    // and each round trip pushed another `SkeletonChange` onto the engine's
    // history, evicting the user's real undo entries.
    case 'SKELETON2D_UPDATED': {
      const payload = castPayload<{ entityId: string; data: unknown }>(data);
      const skeleton = parseSkeletonWire2d(payload.data);
      if (!skeleton) return true;
      useEditorStore.getState().applySkeleton2dFromEngine(payload.entityId, skeleton);
      return true;
    }

    case 'SKELETAL_ANIMATION2D_PLAYING': {
      // Animation playback state could be tracked here if needed
      return true;
    }

    case 'SKELETON2D_SKIN_CHANGED': {
      const payload = castPayload<{ entityId: string; skinName: string }>(data);
      const state = useEditorStore.getState();
      // A bare `skeletons2d[id]` read walks the prototype chain, so an entity id
      // of `__proto__` or `constructor` resolves to a truthy non-skeleton whose
      // spread then writes garbage into the store.
      if (typeof payload.skinName !== 'string') return true;
      if (!Object.hasOwn(state.skeletons2d, payload.entityId)) return true;
      const skeleton = state.skeletons2d[payload.entityId];
      // State-only for the same reason as above: the engine is reporting a skin it
      // has already switched to, so dispatching a full replace back at it is both
      // redundant and destructive.
      state.applySkeleton2dFromEngine(payload.entityId, {
        ...skeleton,
        activeSkin: payload.skinName,
      });
      return true;
    }

    default:
      return false;
  }
}
