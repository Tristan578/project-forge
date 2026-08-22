/**
 * Event handlers for game components, game cameras, input bindings, play tick.
 */

import { useEditorStore, type GameComponentData, firePlayTick } from '@/stores/editorStore';
// The camera payload no longer needs a `GameCameraData` cast here: PF-1126 gave
// the camera its own parser, which owns the flat engine vocabulary and answers
// `null` for a payload it cannot read.
import { parseGameCameraWire } from '@/lib/game/gameCameraPayload';
import { parseEmittedGameComponent } from '@/lib/engine/gameComponentWire';
import { getScriptGameEventCallback } from '@/lib/scripting/useScriptRunner';
import { setCharacterGrounded } from '@/lib/scripting/groundedRegistry';
import { parseSkippedCharacters, describeSkippedCharacters } from '@/lib/engine/characterDiagnostics';
import { showError } from '@/lib/toast';
import { castPayload, type SetFn, type GetFn } from './types';

/**
 * Types already reported, so a per-frame event stream warns once rather than every tick.
 * Keyed by the raw discriminant, which is what a reader needs to identify the mismatch.
 */
const reportedUnrepresentable = new Set<string>();

/**
 * A component the engine holds but this bundle cannot represent must not vanish silently.
 *
 * The realistic trigger is a WASM build ahead of the web bundle: the engine emits a
 * component type this JS has never heard of, the entity still has it attached, and the
 * inspector simply stops listing it. `attachedTypes` is derived from the same store
 * slice, so the type also reappears in the "Add" menu and a second `add_game_component`
 * can be sent for a component the engine already holds. Dropping is still the right
 * call — a half-parsed component would crash the inspector section that renders it —
 * but it has to leave a trace someone can find.
 */
function reportUnrepresentableComponent(entry: unknown): void {
  const type =
    typeof entry === 'object' && entry !== null && typeof (entry as { type?: unknown }).type === 'string'
      ? (entry as { type: string }).type
      : `<${entry === null ? 'null' : typeof entry}>`;
  if (reportedUnrepresentable.has(type)) return;
  reportedUnrepresentable.add(type);
  console.warn(
    `[gameEvents] Engine reported a game component this build cannot represent: "${type}". ` +
      'It is not shown in the inspector. This usually means the engine binary is ahead of the web bundle.'
  );
}

export function handleGameEvent(
  type: string,
  data: Record<string, unknown>,
  _set: SetFn,
  _get: GetFn
): boolean {
  switch (type) {
    case 'GAME_COMPONENT_CHANGED': {
      const raw = castPayload<{ entityId: string; components?: unknown }>(data);
      // The engine sends its own `GameComponentData`, which is an internally-tagged
      // serde enum — flat, with engine field names. It is NOT the store's nested
      // shape, so it must not be cast into one — a cast type-checks and is wrong
      // at runtime, which is the bug this replaced; see `parseEmittedGameComponent`.
      const emitted = Array.isArray(raw.components) ? raw.components : [];
      const components: GameComponentData[] = [];
      for (const entry of emitted) {
        const parsed = parseEmittedGameComponent(entry);
        if (parsed === null) reportUnrepresentableComponent(entry);
        else components.push(parsed);
      }
      const payload = { entityId: raw.entityId, components };
      const state = useEditorStore.getState();
      // Update allGameComponents
      const newAll = { ...state.allGameComponents, [payload.entityId]: payload.components };
      // Update primaryGameComponents if this entity is selected
      const primary = state.primaryId === payload.entityId ? payload.components : state.primaryGameComponents;
      useEditorStore.setState({ allGameComponents: newAll, primaryGameComponents: primary });
      return true;
    }

    case 'GAME_CAMERA_CHANGED': {
      // The engine answers in its own flat vocabulary (`offset`, `damping`,
      // `eyeHeight`, …). Casting `payload.mode` into the union hid every one of
      // those params AND made an engine-side rename invisible to the type
      // checker. A null parse means "unrecognized mode", NOT "clear the camera".
      const parsed = parseGameCameraWire(data);
      if (!parsed) return true;
      const payload = castPayload<{ entityId: string }>(data);
      // `castPayload` is an unchecked assertion, and this id becomes a KEY in
      // `allGameCameras`. An absent one would key the record under the string
      // "undefined", which no `primaryId` ever equals — so the inspector would
      // read null while the store held the camera under a phantom entity.
      if (typeof payload.entityId !== 'string' || payload.entityId === '') return true;
      useEditorStore.getState().setEntityGameCamera(payload.entityId, parsed);
      return true;
    }

    case 'ACTIVE_GAME_CAMERA_CHANGED': {
      const payload = castPayload<{ entityId: string | null }>(data);
      useEditorStore.getState().setActiveGameCameraId(payload.entityId);
      return true;
    }

    case 'PLAY_TICK': {
      const payload = castPayload<{
        entities: Record<string, { position: [number, number, number]; rotation: [number, number, number]; scale: [number, number, number] }>;
        entityInfos: Record<string, { name: string; type: string; colliderRadius: number }>;
        inputState: { pressed: Record<string, boolean>; justPressed: Record<string, boolean>; justReleased: Record<string, boolean>; axes: Record<string, number> };
      }>(data);
      firePlayTick(payload);
      return true;
    }

    case 'GAME_EVENT': {
      // Per-frame game events drained from the engine runtime (win, collectible
      // pickup, …). game_win flips the store flag (drives the HUD win overlay);
      // all events are forwarded to the script worker so forge.game.onWin fires.
      const payload = castPayload<{ eventName: string; sourceEntityId: string | null; targetEntityId: string | null }>(data);
      if (payload.eventName === 'game_win') {
        useEditorStore.getState().setGameWon(true);
      }
      getScriptGameEventCallback()?.(payload);
      return true;
    }

    case 'CHARACTER_GROUNDED_CHANGED': {
      // Rapier decides ground contact inside the character sweep (PF-1214) and
      // the play-tick wire carries transforms only, so this event is the sole
      // path by which a script can tell a jump from a fall. The engine emits
      // CHANGES, never a per-frame flood, so the mirror has to be kept.
      const payload = castPayload<{ entityId: string; grounded: boolean }>(data);
      // `castPayload` is an unchecked assertion and this id becomes a KEY in
      // the mirror: an absent one would file the contact under the string
      // "undefined", where no script would ever find it.
      if (typeof payload.entityId !== 'string' || payload.entityId === '') return true;
      // Strict `=== true`: anything else means "not standing on something", so
      // a mismatched engine build cannot make thin air walkable.
      setCharacterGrounded(payload.entityId, payload.grounded === true);
      return true;
    }

    case 'CHARACTER_CONTROLLER_DIAGNOSTICS': {
      // A character with no collider is never CONSIDERED by the attach query,
      // so it produces no error, no rejected command and no
      // CHARACTER_GROUNDED_CHANGED — nothing on this wire tells it apart from a
      // working character. This event is the entire in-product signal, and the
      // engine writes it on every 3D Edit->Play transition, so this arm fires at
      // play start (PF-1214, review finding #2).
      const skipped = parseSkippedCharacters(data);
      if (skipped === null) {
        // Handled — the name is ours — but say so, because a payload shape we
        // cannot read means the engine binary is ahead of this bundle and the
        // player is getting silence where a warning was due.
        console.warn(
          '[gameEvents] CHARACTER_CONTROLLER_DIAGNOSTICS payload was unreadable; ' +
            'characters skipped for want of a collider will not be reported.'
        );
        return true;
      }
      // Changes-only, and the change to an EMPTY list is how this learns a
      // scene was repaired. There is nothing to show for it: the toast is
      // transient, so "fixed" is simply the absence of the next one.
      if (skipped.length === 0) return true;
      const { nodes } = useEditorStore.getState().sceneGraph;
      showError(
        describeSkippedCharacters(skipped, entityId =>
          Object.hasOwn(nodes, entityId) ? nodes[entityId].name : undefined
        )
      );
      return true;
    }

    default:
      return false;
  }
}
