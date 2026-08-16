/**
 * Command routing for cutscene playback.
 *
 * `CutscenePlayer` (`./player.ts`) builds a command per keyframe and hands it to
 * whatever dispatcher it was constructed with. Most of those commands are real
 * engine commands, so the natural dispatcher is the engine's — but not all of
 * them are. A dialogue keyframe emits `start_dialogue`, which the engine has
 * never known: it lives entirely in the browser, in the dialogue store.
 *
 * Handing it to the engine anyway got a beat that never played. Since PF-1098
 * the engine's rejection is at least *visible* — the tracked dispatcher in
 * `stores/editorStore.ts` turns a `success: false` response into a `console.error`
 * and a Sentry capture — but that is a developer-only signal, and an observed
 * rejection is still not a handled command. Nothing opened the dialogue.
 *
 * This module is the seam that routes such commands to their real handler, and
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
 * Per-playback memory of which cutscene beats a local handler has already run.
 *
 * A duration-based keyframe is re-dispatched on every animation frame so easing can
 * be stepped, which for a trigger command means ~60 identical dispatches a second.
 * Inferring "already handled" from live store state is not enough: the dialogue
 * runtime stops looking active the moment the viewer closes the conversation, so the
 * next frame reopened the tree at its first line and the dialogue could not be
 * dismissed for the rest of the beat's window.
 *
 * The memory is created per dispatcher, and `play_cutscene` builds a dispatcher per
 * playback, so it resets whenever a cutscene is loaded or replayed without needing a
 * teardown hook — a stopped-and-restarted cutscene plays its dialogue again.
 */
export interface CutsceneDispatchSession {
  readonly handledBeats: Set<string>;
}

/**
 * Identity of the keyframe a dispatch came from, or `null` if it carries none.
 *
 * `beat` is the keyframe's timestamp, stamped by `buildCommand` in `./player.ts`.
 * A dispatch without one is left to the live-state guard below rather than being
 * given a synthetic identity that could suppress an unrelated dispatch.
 */
function beatKey(record: Record<string, unknown>): string | null {
  const beat = record.beat;
  if (typeof beat !== 'number' || !Number.isFinite(beat)) return null;
  const treeId = typeof record.treeId === 'string' ? record.treeId : '';
  const entityId = typeof record.entityId === 'string' ? record.entityId : '';
  return `${beat}|${entityId}|${treeId}`;
}

/**
 * Open a dialogue tree named by a cutscene keyframe.
 *
 * Every rejection warns. The store's own `startDialogue` returns silently for an
 * unknown tree, which is the same silence this module exists to remove: a cutscene
 * pointing at a deleted tree would otherwise play through the beat with no dialogue
 * and no explanation.
 */
function startDialogueFromKeyframe(payload: unknown, session: CutsceneDispatchSession): void {
  const record = asRecord(payload);
  if (!record) {
    console.warn('[cutscene] start_dialogue keyframe has no payload — skipping');
    return;
  }

  // One decision per beat, whatever that decision turns out to be. Recorded before
  // the checks rather than after the store call so the rejection paths below warn
  // once too: a keyframe naming a deleted tree used to log on every frame of its
  // window, ~60 lines a second for a single authoring mistake.
  const key = beatKey(record);
  if (key !== null) {
    if (session.handledBeats.has(key)) return;
    session.handledBeats.add(key);
  }

  const treeId = record.treeId;
  if (typeof treeId !== 'string' || treeId.length === 0) {
    console.warn('[cutscene] start_dialogue keyframe names no dialogue tree — skipping');
    return;
  }

  const { dialogueTrees, runtime, startDialogue } = useDialogueStore.getState();

  // Object.hasOwn, not a bare read: `dialogueTrees['__proto__']` is Object.prototype
  // and `['constructor']` is a function — both truthy, so a bare read would pass a
  // tree id that names no tree straight through to `startDialogue`, where
  // `tree.nodes.find(...)` throws. That throw would escape into the player's rAF
  // callback and strand playback (see the catch in createCutsceneDispatcher).
  if (!Object.hasOwn(dialogueTrees, treeId)) {
    console.warn(`[cutscene] dialogue tree "${treeId}" does not exist — skipping`);
    return;
  }

  // Backstop for a dispatch that carries no beat identity (anything not built by
  // `./player.ts`). It only holds while the tree is still open — the moment the
  // viewer closes the conversation this stops applying — so it is the weaker of the
  // two guards and must not be the only one. Re-opening the tree the viewer is
  // already in would reset it to its start node and discard their history.
  if (runtime.isActive && runtime.activeTreeId === treeId) return;

  startDialogue(treeId);
}

/**
 * Commands a cutscene emits that the engine does not route.
 *
 * Keep this exhaustive: anything absent here is forwarded to the engine, which
 * rejects what it does not know — logged since PF-1098, but still nothing that
 * plays the beat.
 *
 * Enforcement: `__tests__/dispatch.test.ts` walks every command `buildCommand` can
 * emit for every `CUTSCENE_TRACK_TYPES` entry and fails if one is routed by neither
 * this map nor the engine's own `core/commands/*.rs` dispatch arms. Add the command
 * here before adding the track type, or the test will name it for you.
 */
export const LOCAL_CUTSCENE_COMMANDS = {
  start_dialogue: startDialogueFromKeyframe,
} as const;

/**
 * Wrap the engine dispatcher so browser-side cutscene commands reach their handler.
 *
 * Commands are looked up with `Object.hasOwn` rather than a bare property read — a
 * command named `constructor` or `toString` would otherwise resolve to an inherited
 * function and be "handled" by it.
 */
export function createCutsceneDispatcher(engineDispatch: CommandDispatcher): CommandDispatcher {
  const session: CutsceneDispatchSession = { handledBeats: new Set<string>() };

  return (command, payload) => {
    if (Object.hasOwn(LOCAL_CUTSCENE_COMMANDS, command)) {
      // A local route runs real store code inside the player's rAF callback, and
      // that callback schedules the next frame *after* dispatching. An exception
      // escaping here would therefore not just drop one beat — it would stop the
      // loop with the cutscene mid-playback, leaving the editor in play mode with
      // no completion callback and no way out but a reload.
      try {
        LOCAL_CUTSCENE_COMMANDS[command as keyof typeof LOCAL_CUTSCENE_COMMANDS](payload, session);
      } catch (err) {
        console.warn(`[cutscene] local handler for "${command}" failed — skipping`, err);
      }
      return;
    }
    engineDispatch(command, payload);
  };
}
