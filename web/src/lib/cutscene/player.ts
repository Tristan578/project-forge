/**
 * CutscenePlayer — rAF-based command scheduler for cutscene playback.
 *
 * Dispatches engine commands at scheduled timestamps by walking each track's
 * keyframes and firing commands when the playback clock reaches them. Camera and
 * animation route through the existing engine command pipeline — no new Rust
 * systems required.
 *
 * Dialogue and audio do NOT, despite dispatching as though they did: see the
 * KNOWN DEAD PATH notes in `buildCommand` and PF-1154. This header used to claim
 * all four tracks worked, which is the only reason the gap survived this long.
 */

import type { Cutscene, CutsceneTrack, CutsceneKeyframe } from '@/stores/cutsceneStore';
import { useCutsceneStore } from '@/stores/cutsceneStore';
import {
  buildSetGameCameraPayload,
  isCameraMode,
  NUMERIC_CAMERA_FIELDS,
} from '@/lib/game/gameCameraPayload';
import type { SetGameCameraPayload } from '@/lib/game/gameCameraPayload';
import type { GameCameraData } from '@/stores/slices/types';
import { sanitizeKeyframePayload } from './keyframePayload';

// ============================================================================
// Types
// ============================================================================

export type CommandDispatcher = (command: string, payload: unknown) => void;

export interface PlayerOptions {
  dispatchCommand: CommandDispatcher;
  /** Called when playback reaches the end of the cutscene. */
  onComplete?: () => void;
  /** Called when playback is stopped early. */
  onStop?: () => void;
}

interface ScheduledKeyframe {
  trackId: string;
  trackType: CutsceneTrack['type'];
  entityId: string | null;
  keyframe: CutsceneKeyframe;
  fired: boolean;
}

// ============================================================================
// Easing utilities
// ============================================================================

export function applyEasing(t: number, easing: CutsceneKeyframe['easing']): number {
  const clamped = Math.max(0, Math.min(1, t));
  switch (easing) {
    case 'ease_in':
      return clamped * clamped;
    case 'ease_out':
      return clamped * (2 - clamped);
    case 'ease_in_out':
      return clamped < 0.5
        ? 2 * clamped * clamped
        : -1 + (4 - 2 * clamped) * clamped;
    case 'linear':
    default:
      return clamped;
  }
}

// ============================================================================
// Command builders
// ============================================================================

/**
 * Read a camera keyframe's payload into a `set_game_camera` command payload.
 *
 * Keyframe payloads are `Record<string, unknown>` written by the cutscene
 * generator — i.e. model output. They are read field by field against an
 * allowlist, never spread onto the command: a spread would hand the engine
 * whatever keys the model invented, and every key the engine does not
 * recognize is dropped with no error, no log and no failing test.
 *
 * Returns null when the track names no camera entity, or when the payload's
 * mode is absent or unrecognized. `set_game_camera` configures a specific
 * camera entity, so there is nothing to address without one — the same reason
 * the animation and audio tracks return null without an `entityId`.
 *
 * Exported for its tests, which are the only caller that reaches it with an
 * unsanitized payload. `buildCommand` sanitizes first, so every own-key guard
 * below is unreachable through it — testing them through `buildCommand` yields
 * assertions that pass whether or not the guards are there. See the note beside
 * the numeric loop for why the guards stay regardless.
 */
export function buildCameraCommandPayload(
  entityId: string | null,
  payload: Record<string, unknown>,
): SetGameCameraPayload | null {
  if (!entityId) return null;

  // `Object.hasOwn` on these two for exactly the reason the loop below states.
  // They used to be bare reads while the loop was guarded, which made the
  // justification written there true of one field in three — and `mode` is the
  // one that decides whether this dispatches at all, so it is the worst of the
  // three to leave open.
  const rawMode = Object.hasOwn(payload, 'mode') ? payload.mode : undefined;
  if (!isCameraMode(rawMode)) return null;

  const rawTarget = Object.hasOwn(payload, 'targetEntity') ? payload.targetEntity : undefined;
  const data: GameCameraData = {
    mode: rawMode,
    targetEntity: typeof rawTarget === 'string' && rawTarget !== '' ? rawTarget : null,
  };

  // `NUMERIC_CAMERA_FIELDS` rather than a locally filtered list: the translator
  // owns which of its fields hold a number, so a non-numeric one added there
  // cannot end up assigned a number here.
  for (const key of NUMERIC_CAMERA_FIELDS) {
    // Own keys only. Keyframe payloads are model-authored, and a bare read walks
    // the prototype chain — the value picked up there is then written as an OWN
    // property on `data`, so `buildSetGameCameraPayload`'s own `Object.hasOwn`
    // check downstream cannot tell it apart from one the author really set.
    //
    // `sanitizeKeyframePayload` now runs ahead of this and would have dropped
    // such a key already. This stays because the guarantee is the caller's, not
    // this function's: the parameter says `Record<string, unknown>`, and a second
    // call site that reads a payload from somewhere else would inherit the hole
    // rather than a type error.
    if (!Object.hasOwn(payload, key)) continue;
    const value = payload[key];
    if (typeof value === 'number' && Number.isFinite(value)) data[key] = value;
  }

  return buildSetGameCameraPayload(entityId, data);
}

/**
 * Translate a keyframe payload into an engine command for the given track type.
 * Returns null if the track type is 'wait' (no command to dispatch).
 */
export function buildCommand(
  trackType: CutsceneTrack['type'],
  entityId: string | null,
  keyframe: CutsceneKeyframe,
  // Nothing consumes playback progress today. The camera command used to carry
  // it as `_easedProgress`, a field no engine command has ever read and nothing
  // on the JS side consumed either — so easing a camera keyframe has always been
  // a no-op. Interpolating would mean lerping the camera between its current and
  // target state JS-side and dispatching each step; `set_game_camera` is an
  // absolute set with no interpolation of its own. The parameter stays so the
  // scheduler's call sites keep their shape when that lands.
  _progress: number,
): { command: string; payload: unknown } | null {
  // Read against the track type's vocabulary before anything below touches it.
  // This is the dispatch boundary, and it does not get to assume its input came
  // from the generator: the store also takes keyframes from the timeline editor
  // and from a saved project, neither of which passes through the parse-time
  // check. What arrives here is `Record<string, unknown>` and nothing more.
  const payload = sanitizeKeyframePayload(trackType, keyframe.payload);

  switch (trackType) {
    case 'camera': {
      const cameraPayload = buildCameraCommandPayload(entityId, payload);
      if (!cameraPayload) return null;
      return { command: 'set_game_camera', payload: cameraPayload };
    }
    case 'animation': {
      if (!entityId) return null;
      // No clip names nothing to play. This used to fall back to `''` and
      // dispatch anyway — a `play_animation` for the empty clip, which the
      // engine can only ignore, indistinguishable in a log from one that worked.
      const { clipName } = payload;
      if (typeof clipName !== 'string') return null;
      // `crossfadeSecs` is a non-negative finite number or absent by the time it
      // gets here — it used to be forwarded unread, string or object included.
      // When it is absent the key is OMITTED rather than filled in with a local
      // default: `handle_play_animation` reads it as `unwrap_or(0.3)`, so writing
      // a `0` here would not be "no opinion", it would be an instant cut
      // overriding the engine's own crossfade. Omission is how you ask for the
      // engine default (PF-1126).
      const animationPayload: Record<string, unknown> = { entityId, clipName };
      if (payload.crossfadeSecs !== undefined) {
        animationPayload.crossfadeSecs = payload.crossfadeSecs;
      }
      return { command: 'play_animation', payload: animationPayload };
    }
    case 'dialogue': {
      // Unlike the other tracks this one does not need an entity — a cutscene can
      // narrate without anyone speaking — but it does need a tree to start, and
      // `treeId` used to be forwarded unread, so a missing one started a dialogue
      // named `undefined`.
      const { treeId } = payload;
      if (typeof treeId !== 'string') return null;
      // KNOWN DEAD PATH (PF-1154): `start_dialogue` is not a command the engine
      // has an arm for, and nothing on the JS side intercepts it either — the
      // dispatcher handed to this player is the raw engine dispatcher. Starting a
      // dialogue is a store action (`useDialogueStore.getState().startDialogue`),
      // which is how the script runtime does it. So this dispatch has never done
      // anything, and `handle_command` answers it with an `Err` nobody reads.
      // Routing it correctly changes cutscene playback behaviour, so it is its
      // own change rather than a rider on payload validation.
      return {
        command: 'start_dialogue',
        payload: { treeId, entityId: entityId ?? undefined },
      };
    }
    case 'audio': {
      if (!entityId) return null;
      return {
        command: 'play_audio',
        // Spreading is safe here only because `payload` is now built key by key
        // from the audio vocabulary rather than being the model's own object.
        // The same line over the raw payload was the "never spread LLM objects
        // into engine commands" gotcha, with a model on the other end of it.
        //
        // KNOWN DEAD FIELDS (PF-1154): `handle_play_audio` reads `entityId` and
        // nothing else, so the `volume` and `pitch` a generated cutscene asks for
        // reach nothing. They belong on `set_audio`, which means dispatching two
        // commands for one keyframe — a scheduler change, not a payload one.
        payload: { entityId, ...payload },
      };
    }
    case 'wait':
      return null;
    default:
      return null;
  }
}

// ============================================================================
// CutscenePlayer
// ============================================================================

export class CutscenePlayer {
  private cutscene: Cutscene | null = null;
  private options: PlayerOptions;
  private rafHandle: number | null = null;
  private startTime: number | null = null;
  private pausedAt: number | null = null;
  private currentTime = 0;
  private scheduled: ScheduledKeyframe[] = [];

  constructor(options: PlayerOptions) {
    this.options = options;
  }

  /** Load a cutscene for playback. Resets all playback state. */
  load(cutscene: Cutscene): void {
    this.stop();
    this.cutscene = cutscene;
    this.currentTime = 0;
    this.scheduled = this.buildSchedule(cutscene);
  }

  /** Start playback from the beginning (or resume if paused). */
  play(): void {
    if (!this.cutscene) return;

    if (this.pausedAt !== null) {
      // Resuming — shift start time to account for paused duration
      if (this.startTime !== null) {
        this.startTime += performance.now() - this.pausedAt;
      }
      this.pausedAt = null;
    } else {
      this.startTime = performance.now() - this.currentTime * 1000;
      // Reset all fired flags when starting fresh
      for (const item of this.scheduled) {
        item.fired = false;
      }
    }

    useCutsceneStore.getState().setPlaybackState('playing');
    this.scheduleFrame();
  }

  /** Pause playback at the current position. */
  pause(): void {
    if (this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }
    this.pausedAt = performance.now();
    useCutsceneStore.getState().setPlaybackState('paused');
  }

  /** Stop playback and reset to start. */
  stop(): void {
    // Only fire onStop when playback was actually in progress.
    // load() calls stop() internally to reset state before loading a new
    // cutscene — without this guard, load() would spuriously dispatch
    // 'stop' even though nothing was playing.
    const wasPlaying = this.rafHandle !== null || this.startTime !== null;
    if (this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }
    this.startTime = null;
    this.pausedAt = null;
    this.currentTime = 0;
    useCutsceneStore.getState().setPlaybackState('stopped');
    useCutsceneStore.getState().setPlaybackTime(0);
    if (wasPlaying) {
      this.options.onStop?.();
    }
  }

  /** Seek to a specific time in seconds. */
  seek(timeSecs: number): void {
    if (!this.cutscene) return;
    const clamped = Math.max(0, Math.min(timeSecs, this.cutscene.duration));
    this.currentTime = clamped;
    useCutsceneStore.getState().setPlaybackTime(clamped);
    // Re-mark keyframes before the seek point as fired so they don't replay
    for (const item of this.scheduled) {
      item.fired = item.keyframe.timestamp <= clamped;
    }
    if (this.startTime !== null) {
      this.startTime = performance.now() - clamped * 1000;
    }
  }

  get isPlaying(): boolean {
    return this.rafHandle !== null;
  }

  // --------------------------------------------------------------------------
  // Private
  // --------------------------------------------------------------------------

  private buildSchedule(cutscene: Cutscene): ScheduledKeyframe[] {
    const items: ScheduledKeyframe[] = [];
    for (const track of cutscene.tracks) {
      if (track.muted) continue;
      for (const keyframe of track.keyframes) {
        items.push({
          trackId: track.id,
          trackType: track.type,
          entityId: track.entityId,
          keyframe,
          fired: false,
        });
      }
    }
    // Sort by timestamp ascending
    items.sort((a, b) => a.keyframe.timestamp - b.keyframe.timestamp);
    return items;
  }

  private scheduleFrame(): void {
    this.rafHandle = requestAnimationFrame(this.tick.bind(this));
  }

  private tick(): void {
    if (!this.cutscene || this.startTime === null) return;

    this.currentTime = (performance.now() - this.startTime) / 1000;

    if (this.currentTime >= this.cutscene.duration) {
      this.currentTime = this.cutscene.duration;
      useCutsceneStore.getState().setPlaybackTime(this.currentTime);
      this.fireKeyframesAt(this.currentTime);
      this.rafHandle = null;
      useCutsceneStore.getState().setPlaybackState('idle');
      this.options.onComplete?.();
      return;
    }

    useCutsceneStore.getState().setPlaybackTime(this.currentTime);
    this.fireKeyframesAt(this.currentTime);
    this.scheduleFrame();
  }

  private fireKeyframesAt(time: number): void {
    for (const item of this.scheduled) {
      if (item.keyframe.timestamp > time) continue;

      const elapsed = time - item.keyframe.timestamp;

      if (item.keyframe.duration > 0) {
        // Duration-based keyframe: re-fire every frame while within the window
        // so that easing interpolation is applied continuously.
        // Once elapsed exceeds duration AND we've already dispatched progress=1.0,
        // skip further processing. The `fired` flag ensures the final frame is
        // always dispatched even when rAF skips past the exact end boundary.
        if (elapsed > item.keyframe.duration && item.fired) continue;
        const progress = Math.min(elapsed / item.keyframe.duration, 1);
        const cmd = buildCommand(item.trackType, item.entityId, item.keyframe, progress);
        if (cmd) {
          this.options.dispatchCommand(cmd.command, cmd.payload);
        }
        if (progress >= 1) item.fired = true;
      } else {
        // Instantaneous keyframe: fire once only to avoid duplicate commands.
        if (item.fired) continue;
        const cmd = buildCommand(item.trackType, item.entityId, item.keyframe, 1);
        if (cmd) {
          this.options.dispatchCommand(cmd.command, cmd.payload);
        }
        item.fired = true;
      }
    }
  }
}
