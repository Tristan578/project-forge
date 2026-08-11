/**
 * CutscenePlayer — rAF-based command scheduler for cutscene playback.
 *
 * Dispatches engine commands at scheduled timestamps by walking each track's
 * keyframes and firing commands when the playback clock reaches them. All
 * actual work (camera, animation, dialogue, audio) routes through the existing
 * engine command pipeline — no new Rust systems required.
 */

import type { Cutscene, CutsceneTrack, CutsceneKeyframe } from '@/stores/cutsceneStore';
import { useCutsceneStore } from '@/stores/cutsceneStore';
import {
  blendGameCameraData,
  buildSetGameCameraPayload,
  isCameraMode,
  normalizeTargetEntity,
  NUMERIC_CAMERA_FIELDS,
} from '@/lib/game/gameCameraPayload';
import type { SetGameCameraPayload } from '@/lib/game/gameCameraPayload';
import type { GameCameraData } from '@/stores/slices/types';

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
  /**
   * The keyframe before this one ON THE SAME TRACK, or null for a track's first.
   *
   * Linked while the track is still intact, because the schedule is flattened
   * across every track and sorted by timestamp — after that, "the previous
   * element" is whichever track happened to fire last, which is not a state this
   * one is moving from.
   */
  prev: CutsceneKeyframe | null;
  fired: boolean;
}

/**
 * Track types whose command is a state to interpolate rather than an event.
 *
 * A duration-based keyframe re-dispatches on every animation frame so easing can
 * be stepped, and that is only meaningful where the command sets a state the
 * next dispatch can supersede — today, the camera. `play_audio`, `play_animation`
 * and `start_dialogue` are one-shot triggers: re-sending them 60 times a second
 * for the length of the keyframe restarts the sound, the clip and the dialogue
 * on every frame. That is what this scheduler did to every non-camera track with
 * a duration, which is most of them.
 */
const INTERPOLATED_TRACK_TYPES = new Set<CutsceneTrack['type']>(['camera']);

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
 * Read a camera keyframe's payload into the authoring vocabulary.
 *
 * Keyframe payloads are `Record<string, unknown>` written by the cutscene
 * generator — i.e. model output. They are read field by field against an
 * allowlist, never spread onto the command: a spread would hand the engine
 * whatever keys the model invented, and every key the engine does not
 * recognize is dropped with no error, no log and no failing test.
 *
 * Returns null when the payload's mode is absent or unrecognized — there is no
 * camera state to describe without one.
 */
function readCameraData(payload: Record<string, unknown>): GameCameraData | null {
  const rawMode = payload.mode;
  if (!isCameraMode(rawMode)) return null;

  const data: GameCameraData = {
    mode: rawMode,
    targetEntity: normalizeTargetEntity(payload.targetEntity),
  };

  // `NUMERIC_CAMERA_FIELDS` rather than a locally filtered list: the translator
  // owns which of its fields hold a number, so a non-numeric one added there
  // cannot end up assigned a number here.
  for (const key of NUMERIC_CAMERA_FIELDS) {
    // Own keys only. Keyframe payloads are model-authored, and a bare read walks
    // the prototype chain — the value picked up there is then written as an OWN
    // property on `data`, so `buildSetGameCameraPayload`'s own `Object.hasOwn`
    // check downstream cannot tell it apart from one the author really set.
    if (!Object.hasOwn(payload, key)) continue;
    const value = payload[key];
    if (typeof value === 'number' && Number.isFinite(value)) data[key] = value;
  }

  return data;
}

/**
 * Build the `set_game_camera` payload for one frame of a camera keyframe.
 *
 * Returns null when the track names no camera entity: `set_game_camera`
 * configures a specific camera entity, so there is nothing to address without
 * one — the same reason the animation and audio tracks return null without an
 * `entityId`.
 */
function buildCameraCommandPayload(
  entityId: string | null,
  keyframe: CutsceneKeyframe,
  prevKeyframe: CutsceneKeyframe | null,
  progress: number,
): SetGameCameraPayload | null {
  if (!entityId) return null;

  const target = readCameraData(keyframe.payload);
  if (!target) return null;

  const from = prevKeyframe ? readCameraData(prevKeyframe.payload) : null;
  const eased = applyEasing(progress, keyframe.easing);

  return buildSetGameCameraPayload(entityId, blendGameCameraData(from, target, eased));
}

/**
 * Whether a camera keyframe has anything to step frame by frame.
 *
 * `blendGameCameraData` can only blend from the previous keyframe on the same
 * track in the same mode; with no predecessor, or across a mode change, it
 * returns the target unchanged. Re-dispatching that identical payload every
 * animation frame changes nothing in the engine while re-running the whole
 * `GAME_CAMERA_CHANGED` → store → React path ~60 times a second, so a keyframe
 * that cannot blend cuts and fires once, like every other one-shot.
 */
function cameraKeyframeBlends(item: ScheduledKeyframe): boolean {
  if (!item.prev) return false;
  const to = item.keyframe.payload.mode;
  const from = item.prev.payload.mode;
  return isCameraMode(to) && isCameraMode(from) && to === from;
}

/**
 * Translate a keyframe payload into an engine command for the given track type.
 * Returns null if the track type is 'wait' (no command to dispatch).
 */
export function buildCommand(
  trackType: CutsceneTrack['type'],
  entityId: string | null,
  keyframe: CutsceneKeyframe,
  /**
   * Raw playback progress through this keyframe's duration, 0..1. Only the
   * camera track reads it — see {@link INTERPOLATED_TRACK_TYPES}. The keyframe's
   * own easing curve is applied inside the camera builder, so callers pass the
   * linear fraction, not an eased one.
   */
  progress: number,
  /**
   * The preceding keyframe on the same track, when there is one. Camera state is
   * blended from it; the command used to carry the progress as `_easedProgress`
   * instead — a field no engine command has ever read and nothing on the JS side
   * consumed either, so easing a camera keyframe was a no-op for its whole life.
   */
  prevKeyframe: CutsceneKeyframe | null = null,
): { command: string; payload: unknown } | null {
  const { payload } = keyframe;

  switch (trackType) {
    case 'camera': {
      const cameraPayload = buildCameraCommandPayload(entityId, keyframe, prevKeyframe, progress);
      if (!cameraPayload) return null;
      return { command: 'set_game_camera', payload: cameraPayload };
    }
    case 'animation': {
      if (!entityId) return null;
      const clipName = typeof payload.clipName === 'string' ? payload.clipName : '';
      return {
        command: 'play_animation',
        payload: { entityId, clipName, crossfadeSecs: payload.crossfadeSecs ?? 0 },
      };
    }
    case 'dialogue': {
      // `start_dialogue` is routed by nothing — not `core/commands`, not any JS
      // dispatcher — so a dialogue keyframe reaches no handler. The comment here
      // used to claim these keyframes "mutate the dialogue store directly via the
      // dispatcher"; the dispatcher is the engine's, and `useDialogueStore` is
      // driven from the narrative panels, never from playback. Wiring it up is
      // PF-1140. Until then a `treeId` that is not a string is refused rather
      // than sent as `undefined`, so the command names a tree or is not built.
      const treeId = typeof payload.treeId === 'string' ? payload.treeId : '';
      if (!treeId) return null;
      return {
        command: 'start_dialogue',
        payload: { treeId, entityId: entityId ?? undefined },
      };
    }
    case 'audio': {
      if (!entityId) return null;
      // `handle_play_audio` reads `entityId` and nothing else — volume, fade and
      // every other key a generated keyframe carries were spread onto the command
      // and dropped by the engine without an error. Sending only the field the
      // handler reads makes that a visible gap instead of a payload that looks
      // like it configures playback.
      return { command: 'play_audio', payload: { entityId } };
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
      // Per track, in the track's own timestamp order, so `prev` is the state
      // this keyframe moves FROM. A track's keyframes are not guaranteed to be
      // authored in order, and the flattened schedule below is interleaved with
      // every other track, so neither array order alone would do.
      const ordered = [...track.keyframes].sort((a, b) => a.timestamp - b.timestamp);
      for (const [index, keyframe] of ordered.entries()) {
        items.push({
          trackId: track.id,
          trackType: track.type,
          entityId: track.entityId,
          keyframe,
          prev: index > 0 ? ordered[index - 1] : null,
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

      // A duration only means "step this over time" for a track whose command
      // sets a state. For everything else the duration describes how long the
      // triggered thing lasts, and re-triggering it each frame restarts it.
      const interpolates =
        item.keyframe.duration > 0 &&
        INTERPOLATED_TRACK_TYPES.has(item.trackType) &&
        (item.trackType !== 'camera' || cameraKeyframeBlends(item));

      if (interpolates) {
        // Re-fire every frame while within the window so that easing
        // interpolation is applied continuously.
        // Once elapsed exceeds duration AND we've already dispatched progress=1.0,
        // skip further processing. The `fired` flag ensures the final frame is
        // always dispatched even when rAF skips past the exact end boundary.
        if (elapsed > item.keyframe.duration && item.fired) continue;
        const progress = Math.min(elapsed / item.keyframe.duration, 1);
        const cmd = buildCommand(
          item.trackType,
          item.entityId,
          item.keyframe,
          progress,
          item.prev,
        );
        if (cmd) {
          this.options.dispatchCommand(cmd.command, cmd.payload);
        }
        if (progress >= 1) item.fired = true;
      } else {
        // One-shot keyframe: fire once only to avoid duplicate commands.
        if (item.fired) continue;
        const cmd = buildCommand(item.trackType, item.entityId, item.keyframe, 1, item.prev);
        if (cmd) {
          this.options.dispatchCommand(cmd.command, cmd.payload);
        }
        item.fired = true;
      }
    }
  }
}
