import { audioManager } from '@/lib/audio/audioManager';
import type {
  AnimParamData,
  AnimationStateMachineData,
  GameCameraData,
  SpriteAnimatorData,
} from '@/stores/slices/types';

/**
 * Script commands answered on the MAIN THREAD, without ever reaching the engine.
 *
 * `SCRIPT_ALLOWED_COMMANDS` is the set of names a user script may emit, and it
 * has two legitimate kinds of member: names the engine routes AND arms, and
 * names answered here. Anything else is a phantom — `dispatchCommand` posts it,
 * `commands::dispatch` answers `Err("Unknown command: …")`, and the user gets
 * silence from a call `forgeTypes.ts` promised them (PF-1180 / #9284).
 *
 * This module exists so the second kind is CHECKABLE. It used to be a private
 * `handleAudioCommand` inside `useScriptRunner.ts`, mixed in with a `switch` over
 * worker MESSAGE types (`camera_set_mode`, `scene_load`, …) that share the
 * `case '…':` shape but are not command names at all. A scanner pointed at that
 * file cannot tell the two apart. Pointed here it can:
 * `__tests__/scriptAllowlistParity.test.ts` reads the body of
 * {@link handleLocalScriptCommand} and treats exactly those `case` labels as
 * answered JS-side — no second hand-maintained list to fall out of step.
 *
 * Adding a case here is therefore load-bearing: it is what makes a name legal in
 * the allowlist with no engine arm behind it.
 */

/**
 * Track id used when a script names none.
 *
 * `forge.audio.setMusicIntensity(level)` and `loadStems(stems)` take no track,
 * and `chat/handlers/audioHandlers.ts` defaults the same way, so a script and
 * the AI agent address the same track.
 */
const DEFAULT_MUSIC_TRACK_ID = 'default';

/**
 * The slice of the editor store these handlers touch.
 *
 * Structural rather than `ReturnType<typeof useEditorStore.getState>` so this
 * module does not drag the whole store type — and its whole import graph — in
 * behind it. `useScriptRunner` passes `() => useEditorStore.getState()`, which
 * satisfies this by structure.
 */
export interface LocalCommandStore {
  primaryId: string | null;
  activeGameCameraId: string | null;
  allGameCameras: Record<string, GameCameraData>;
  spriteAnimators: Record<string, SpriteAnimatorData>;
  animationStateMachines: Record<string, AnimationStateMachineData>;
  setGameCamera: (entityId: string, data: GameCameraData) => void;
  setSpriteAnimator: (entityId: string, data: SpriteAnimatorData) => void;
  setAnimationStateMachine: (entityId: string, data: AnimationStateMachineData) => void;
}

/** The camera a script's `forge.camera.*` call addresses, or `null` if none. */
function activeCameraId(store: LocalCommandStore): string | null {
  return store.activeGameCameraId || store.primaryId || null;
}

/**
 * `record[key]`, but only for an OWN key.
 *
 * Every key reaching these lookups came off a user script, and a bare
 * `record['constructor']` resolves to an inherited function that would then be
 * spread into a store component.
 */
function ownEntry<T>(record: Record<string, T>, key: unknown): T | undefined {
  return typeof key === 'string' && Object.hasOwn(record, key) ? record[key] : undefined;
}

/** The same param with a new value, coerced to whatever type the param declares. */
function withValue(previous: AnimParamData, raw: unknown): AnimParamData | null {
  if (previous.type === 'float') {
    const value = Number(raw);
    return Number.isFinite(value) ? { type: 'float', value } : null;
  }
  return { type: previous.type, value: Boolean(raw) };
}

/**
 * Handle a script command main-thread-side.
 *
 * @returns `true` when the command was answered here and must NOT be dispatched
 *   to the engine; `false` when it is not ours.
 */
export function handleLocalScriptCommand(
  cmdName: string,
  payload: Record<string, unknown>,
  getStore: () => LocalCommandStore,
): boolean {
  switch (cmdName) {
    // ─── Audio layering / transitions ──────────────────────────────────────
    case 'audio_add_layer':
      audioManager.addLayer(
        payload.entityId as string,
        payload.slotName as string,
        payload.assetId as string,
        {
          volume: payload.volume as number | undefined,
          pitch: payload.pitch as number | undefined,
          loop: payload.loop as boolean | undefined,
          spatial: payload.spatial as boolean | undefined,
          bus: payload.bus as string | undefined,
        }
      );
      return true;
    case 'audio_remove_layer':
      audioManager.removeLayer(payload.entityId as string, payload.slotName as string);
      return true;
    case 'audio_remove_all_layers':
      audioManager.removeAllLayers(payload.entityId as string);
      return true;
    case 'audio_crossfade':
      audioManager.crossfade(
        payload.fromEntityId as string,
        payload.toEntityId as string,
        payload.durationMs as number
      );
      return true;
    case 'audio_play_one_shot':
      audioManager.playOneShot(payload.assetId as string, {
        position: payload.position as [number, number, number] | undefined,
        bus: payload.bus as string | undefined,
        volume: payload.volume as number | undefined,
        pitch: payload.pitch as number | undefined,
      });
      return true;
    case 'audio_fade_in':
      audioManager.fadeIn(payload.entityId as string, payload.durationMs as number);
      return true;
    case 'audio_fade_out':
      audioManager.fadeOut(payload.entityId as string, payload.durationMs as number);
      return true;
    case 'audio_save_snapshot':
      audioManager.saveSnapshot(
        payload.name as string,
        payload.crossfadeDurationMs as number | undefined
      );
      return true;
    case 'audio_load_snapshot':
      audioManager.loadSnapshot(
        payload.name as string,
        payload.durationMs as number | undefined
      );
      return true;
    case 'audio_detect_loop_points':
      audioManager.detectLoopPoints(
        payload.assetId as string,
        {
          maxResults: payload.maxResults as number | undefined,
          minLoopDuration: payload.minLoopDuration as number | undefined,
        }
      );
      return true;

    // ─── Adaptive music ────────────────────────────────────────────────────
    // Both were phantoms until PF-1180. They sit next to the `audio_*` layering
    // names above and read like them, but neither had an `audioManager` case nor
    // an engine arm. `audioManager.setMusicIntensity`'s own comment already named
    // `forge.audio.setMusicIntensity` as its caller — the wiring that would have
    // made that true had never been written.
    case 'set_music_intensity':
      audioManager.setMusicIntensity(
        (payload.trackId as string | undefined) ?? DEFAULT_MUSIC_TRACK_ID,
        payload.intensity as number,
        payload.rampMs as number | undefined,
      );
      return true;
    case 'set_music_stems': {
      // `forge.audio.loadStems` takes `{ stemName: assetId }`; `setAdaptiveMusic`
      // takes the array form `chat/handlers/audioEntityHandlers.ts` builds.
      // Converting here keeps the script-facing shape ergonomic without adding a
      // second audioManager entry point.
      const raw = payload.stems;
      const stems = Object.entries(
        raw !== null && typeof raw === 'object' ? (raw as Record<string, string>) : {},
      )
        .filter(([, assetId]) => typeof assetId === 'string')
        .map(([name, assetId]) => ({ name, assetId }));
      audioManager.setAdaptiveMusic(
        (payload.trackId as string | undefined) ?? DEFAULT_MUSIC_TRACK_ID,
        stems,
      );
      return true;
    }

    // ─── Haptics ───────────────────────────────────────────────────────────
    // `navigator.vibrate` is main-thread-only — a worker cannot reach it — so
    // `forge.input.vibrate` always had to come back here. It was routed at the
    // engine instead, which has no notion of a device's vibrator at all.
    case 'vibrate': {
      const pattern = payload.pattern;
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        // A non-array pattern would throw inside `vibrate`; `0` is the spec's
        // own "cancel any running vibration", which is the safe reading of a
        // malformed call.
        navigator.vibrate(
          Array.isArray(pattern) && pattern.every((n) => Number.isFinite(n))
            ? (pattern as number[])
            : 0,
        );
      }
      return true;
    }

    // ─── Sprite animation ──────────────────────────────────────────────────
    // Sprite animation state lives in the store, which dispatches
    // `set_sprite_animator` / `set_animation_state_machine` — both routed and
    // armed. The four `*_sprite_anim*` names a script emits were never engine
    // commands; they are authoring verbs over those two components, exactly as
    // `chat/handlers/handlers2d.ts` already implements them for the AI agent.
    case 'play_sprite_animation': {
      const store = getStore();
      const existing = ownEntry(store.spriteAnimators, payload.entityId);
      if (!existing || typeof payload.clipName !== 'string') return true;
      store.setSpriteAnimator(payload.entityId as string, {
        ...existing,
        currentClip: payload.clipName,
        playing: true,
        frameIndex: 0,
      });
      return true;
    }
    case 'stop_sprite_animation': {
      const store = getStore();
      const existing = ownEntry(store.spriteAnimators, payload.entityId);
      if (!existing) return true;
      store.setSpriteAnimator(payload.entityId as string, { ...existing, playing: false });
      return true;
    }
    case 'set_sprite_anim_speed': {
      const store = getStore();
      const existing = ownEntry(store.spriteAnimators, payload.entityId);
      const speed = payload.speed;
      if (!existing || typeof speed !== 'number' || !Number.isFinite(speed)) return true;
      store.setSpriteAnimator(payload.entityId as string, { ...existing, speed });
      return true;
    }
    case 'set_sprite_anim_param': {
      const store = getStore();
      const existing = ownEntry(store.animationStateMachines, payload.entityId);
      if (!existing) return true;
      const previous = ownEntry(existing.parameters, payload.paramName);
      if (!previous) return true;
      const next = withValue(previous, payload.value);
      if (!next) return true;
      store.setAnimationStateMachine(payload.entityId as string, {
        ...existing,
        parameters: { ...existing.parameters, [payload.paramName as string]: next },
      });
      return true;
    }

    // ─── Game camera ───────────────────────────────────────────────────────
    // The same store path the `camera_set_target` / `camera_set_mode` worker
    // MESSAGES already use. `offset` maps onto the three follow fields exactly as
    // `lib/game/gameCameraPayload.ts` reads them back out of the engine's single
    // vector: x → followOffsetX, y → followHeight, z → -followDistance.
    case 'camera_follow': {
      const store = getStore();
      const cameraId = activeCameraId(store);
      if (!cameraId || typeof payload.entityId !== 'string') return true;
      const existing = ownEntry(store.allGameCameras, cameraId) ?? {
        mode: 'thirdPersonFollow' as const,
        targetEntity: null,
      };
      const offset = payload.offset;
      const follow =
        Array.isArray(offset) && offset.length === 3 && offset.every((n) => Number.isFinite(n))
          ? (offset as number[])
          : null;
      store.setGameCamera(cameraId, {
        ...existing,
        mode: 'thirdPersonFollow',
        targetEntity: payload.entityId,
        ...(follow
          ? {
              followOffsetX: follow[0],
              followHeight: follow[1],
              followDistance: -follow[2],
            }
          : {}),
      });
      return true;
    }
    case 'camera_stop_follow': {
      const store = getStore();
      const cameraId = activeCameraId(store);
      if (!cameraId) return true;
      const existing = ownEntry(store.allGameCameras, cameraId);
      if (!existing) return true;
      // Clears the TARGET, not the mode: a later `follow()` resumes tracking
      // without the script having to know which mode it interrupted.
      store.setGameCamera(cameraId, { ...existing, targetEntity: null });
      return true;
    }

    default:
      return false;
  }
}
