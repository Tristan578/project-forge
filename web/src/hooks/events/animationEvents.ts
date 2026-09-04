/**
 * Event handlers for animations, animation clips, skeleton2d.
 */

import { useEditorStore, type AnimationPlaybackState, type AnimationClipData } from '@/stores/editorStore';
import { parseSkeletonWire2d } from '@/lib/skeleton2d/skeletonPayload';
import { castPayload, type SetFn, type GetFn } from './types';
import { applyWhenPrimary } from './primaryGate';

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

    /**
     * Gated through `applyWhenPrimary` rather than a bare `primaryId ===` read:
     * the undo/redo resync drain reports clips on NON-selected entities, and
     * selection resolves one microtask late (SELECTION_CHANGED is coalesced by
     * `createSelectionBatcher`; this handler is synchronous). A synchronous
     * check therefore compares against the PREVIOUS primary on a viewport pick
     * and silently drops the clip for the entity just selected.
     */
    case 'ANIMATION_CLIP_CHANGED': {
      const clipPayload = castPayload<AnimationClipData & { entityId: string }>(data);
      if (typeof clipPayload.entityId !== 'string') return true;
      const { entityId: _entityId, ...clipData } = clipPayload;
      applyWhenPrimary(clipPayload.entityId, () => {
        useEditorStore.setState({ primaryAnimationClip: clipData });
      });
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
    /**
     * The counterpart to ANIMATION_CLIP_CHANGED, which is a flattened clip and
     * so has no way to say "gone" — every key in it belongs to a clip that no
     * longer exists. Emitted by the undo/redo resync drain (#9290).
     *
     * `setState` is state-only by construction; routing this through a
     * dispatching action would send a command back at the engine that just
     * reported the removal.
     *
     * Same deferred gate as its `_CHANGED` sibling, and for the same reason:
     * a synchronous `primaryId ===` read loses the same-tick selection race and
     * leaves a removed clip on screen.
     */
    case 'ANIMATION_CLIP_REMOVED': {
      const payload = castPayload<{ entityId?: string }>(data);
      if (typeof payload.entityId !== 'string') return true;
      applyWhenPrimary(payload.entityId, () => {
        useEditorStore.setState({ primaryAnimationClip: null });
      });
      return true;
    }

    case 'SKELETON2D_UPDATED': {
      const payload = castPayload<{ entityId: string; data: unknown }>(data);
      const skeleton = parseSkeletonWire2d(payload.data);
      if (!skeleton) return true;
      useEditorStore.getState().applySkeleton2dFromEngine(payload.entityId, skeleton);
      return true;
    }

    // The engine cannot express a removal through `SKELETON2D_UPDATED`: that
    // payload requires a rig, and the case above drops any payload it cannot
    // parse. So removals — the `remove_skeleton_2d` command, and undo/redo
    // through the engine's resync queue — arrive on their own event.
    case 'SKELETON2D_REMOVED': {
      const payload = castPayload<{ entityId: string }>(data);
      useEditorStore.getState().applySkeleton2dRemovedFromEngine(payload.entityId);
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
