/**
 * Entity gate for engine events that write "the primary entity's X".
 *
 * Several inbound handlers route a payload straight into a `primary*` store
 * field without checking WHICH entity it describes. That was survivable while
 * the only emitter was a selection-gated one, because then the engine only ever
 * sent the selected entity's state. It stops being survivable the moment
 * anything emits for a non-selected entity — and the undo/redo re-report drain
 * (`ComponentResync`, #9290/#9291) does exactly that, as does restoring a
 * snapshot, which re-reports every component of the entity being brought back.
 *
 * Writing a foreign payload into `primaryMaterial` / `primaryLight` /
 * `primaryShaderEffect` / `primaryTransform` is destructive rather than merely
 * wrong: the inspectors edit with `update*(primaryId, { ...primaryX, ...patch })`,
 * so the next slider move writes the FOREIGN body onto the selected entity. That
 * is the same corruption `applyPrimaryPhysics` in `physicsEvents.ts` already
 * guards against; this is that guard, generalized.
 *
 * The microtask deferral is not optional. Selection resolves one microtask late
 * — `useEngineEvents` routes SELECTION_CHANGED through `createSelectionBatcher`,
 * which coalesces via `queueMicrotask`, while these events are handled
 * synchronously in the same tick — so on a viewport pick the store still reports
 * the PREVIOUS primary when the newly-selected entity's state arrives. Re-check
 * on a microtask of our own, queued after the batcher's.
 *
 * "No selection" is handled by the same deferral rather than written through:
 * `primaryMaterial` survives in the store, so writing it with no reader would
 * simply defer the corruption until the user selects something.
 */

import { useEditorStore } from '@/stores/editorStore';

/**
 * Run `apply` only if `entityId` is (or becomes, this microtask) the primary
 * selection.
 */
export function applyWhenPrimary(entityId: string, apply: () => void): void {
  if (useEditorStore.getState().primaryId === entityId) {
    apply();
    return;
  }

  queueMicrotask(() => {
    if (useEditorStore.getState().primaryId === entityId) {
      apply();
    }
  });
}
