/**
 * Command routing for cutscene playback.
 *
 * {@link CutscenePlayer} builds a command per keyframe and hands it to whatever
 * dispatcher it was constructed with. Most of those commands are real engine
 * commands, so the natural dispatcher is the engine's — but not all of them are.
 * A dialogue keyframe emits `start_dialogue`, which the engine has never known:
 * it lives entirely in the browser, in {@link useDialogueStore}.
 *
 * Because `dispatchCommand` returns `void`, handing `start_dialogue` to the engine
 * did not fail. It did nothing, quietly, for every authored dialogue beat. This
 * module is the seam that routes such commands to their real handler, and
 * `__tests__/dispatch.test.ts` pins the whole set so a new track type or a renamed
 * engine command cannot reintroduce a command that nothing anywhere handles.
 */

import { useDialogueStore } from '@/stores/dialogueStore';
import type { CommandDispatcher } from './player';

function asRecord(payload: unknown): Record<string, unknown> | null {
  return typeof payload === 'object' && payload !== null
    ? (payload as Record<string, unknown>)
    : null;
}

/**
 * Open a dialogue tree named by a cutscene keyframe.
 *
 * Every rejection warns. The store's own `startDialogue` returns silently for an
 * unknown tree, which is the same silence this module exists to remove: a cutscene
 * pointing at a deleted tree would otherwise play through the beat with no dialogue
 * and no explanation.
 */
function startDialogueFromKeyframe(payload: unknown): void {
  const record = asRecord(payload);
  if (!record) {
    console.warn('[cutscene] start_dialogue keyframe has no payload — skipping');
    return;
  }

  const treeId = record.treeId;
  if (typeof treeId !== 'string' || treeId.length === 0) {
    console.warn('[cutscene] start_dialogue keyframe names no dialogue tree — skipping');
    return;
  }

  if (!useDialogueStore.getState().dialogueTrees[treeId]) {
    console.warn(`[cutscene] dialogue tree "${treeId}" does not exist — skipping`);
    return;
  }

  useDialogueStore.getState().startDialogue(treeId);
}

/**
 * Commands a cutscene emits that the engine does not route.
 *
 * Keep this exhaustive: anything absent here is forwarded to the engine, and an
 * engine that does not recognise it drops it without a sound.
 */
export const LOCAL_CUTSCENE_COMMANDS = {
  start_dialogue: startDialogueFromKeyframe,
} as const;

/**
 * Wrap the engine dispatcher so browser-side cutscene commands reach their handler.
 *
 * Commands are looked up with {@link Object.hasOwn} rather than a bare property
 * read — a command named `constructor` or `toString` would otherwise resolve to an
 * inherited function and be "handled" by it.
 */
export function createCutsceneDispatcher(engineDispatch: CommandDispatcher): CommandDispatcher {
  return (command, payload) => {
    if (Object.hasOwn(LOCAL_CUTSCENE_COMMANDS, command)) {
      LOCAL_CUTSCENE_COMMANDS[command as keyof typeof LOCAL_CUTSCENE_COMMANDS](payload);
      return;
    }
    engineDispatch(command, payload);
  };
}
