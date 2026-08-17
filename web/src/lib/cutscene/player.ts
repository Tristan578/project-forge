/**
 * CutscenePlayer — rAF-based command scheduler for cutscene playback.
 *
 * Dispatches engine commands at scheduled timestamps by walking each track's
 * keyframes and firing commands when the playback clock reaches them. Camera and
 * animation route through the existing engine command pipeline — no new Rust
 * systems required.
 *
 * Dialogue does not: `start_dialogue` has no engine arm, so `./dispatch.ts`
 * intercepts it and drives the dialogue store instead. Audio reaches the engine
 * but only as far as `entityId` — `handle_play_audio` reads nothing else, so the
 * `volume`/`pitch` a keyframe carries are deliberately not sent rather than sent
 * and dropped. This header used to claim all four tracks worked end to end,
 * which is the only reason those gaps survived as long as they did.
 *
 * A keyframe that throws costs that keyframe, not the playback — see
 * `fireKeyframesSafely`.
 */

import type { Cutscene, CutsceneTrack, CutsceneKeyframe } from '@/stores/cutsceneStore';
import { useCutsceneStore } from '@/stores/cutsceneStore';
import { captureException } from '@/lib/monitoring/sentry-client';
import {
  blendGameCameraData,
  buildSetGameCameraPayload,
  isCameraMode,
  normalizeTargetEntity,
  NUMERIC_CAMERA_FIELDS,
  readCameraFieldValue,
} from '@/lib/game/gameCameraPayload';
import type { SetGameCameraPayload } from '@/lib/game/gameCameraPayload';
import type { GameCameraData } from '@/stores/slices/types';
import { sanitizeKeyframePayload } from './keyframePayload';

// ============================================================================
// Types
// ============================================================================

export type CommandDispatcher = (command: string, payload: unknown) => void;

/*
 * TRIGGER tracks fire once; STATE tracks re-fire across their window.
 *
 * `play_animation` and `play_audio` are triggers — re-firing restarts the thing
 * they name, so a two-second keyframe on either never advanced past its first
 * instant. `set_game_camera` is a state, and re-firing it is how a camera
 * keyframe's easing curve is actually applied (see `STATE_TRACK_TYPES` and
 * `cameraKeyframeBlends`).
 *
 * An earlier revision made camera fire once too, on the grounds that
 * `apply_set_game_camera_requests` rebuilt the component with
 * `..Default::default()` — zeroing in-flight shake and resetting the orbital and
 * first-person look state on every tick. That is no longer true: the engine now
 * carries the runtime state across and writes THROUGH the query, so a re-fire is
 * idempotent for everything the author did not name (`bridge/game.rs`, PF-1127).
 */

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
 * Track types whose command sets a state rather than triggering an event.
 *
 * The distinction decides two things. A duration-based keyframe re-dispatches on
 * every animation frame so easing can be stepped, and that is only meaningful
 * where the command sets a state the next dispatch can supersede — today, the
 * camera. `play_audio`, `play_animation` and `start_dialogue` are one-shot
 * triggers: re-sending them 60 times a second for the length of the keyframe
 * restarts the sound, the clip and the dialogue on every frame. That is what
 * this scheduler did to every non-camera track with a duration, which is most
 * of them.
 *
 * It also decides what a seek re-applies — see {@link CutscenePlayer.seek}. A
 * state the viewer should be looking at has to be re-sent after jumping over the
 * keyframe that set it; a trigger must not be, or scrubbing replays every sound
 * the cutscene has already played.
 */
const STATE_TRACK_TYPES = new Set<CutsceneTrack['type']>(['camera']);

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
 *
 * Exported for its tests, which are the only caller that reaches it with an
 * unsanitized payload. `buildCommand` sanitizes first, so every own-key guard
 * below is unreachable through it — testing them through `buildCommand` yields
 * assertions that pass whether or not the guards are there. See the note beside
 * the numeric loop for why the guards stay regardless.
 */
export function readCameraData(payload: Record<string, unknown>): GameCameraData | null {
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
    targetEntity: normalizeTargetEntity(rawTarget),
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
    // Finite AND in range for that field, for the same reason the own-key guard
    // stays: `sanitizeKeyframePayload` applies the identical policy ahead of
    // this, but the guarantee belongs to the caller, and the parameter promises
    // only `Record<string, unknown>`. Seven of the nine fields cannot hold a
    // negative — a negative `followSmoothing` makes the follow diverge instead
    // of converge — while `followHeight` and `orbitalAutoRotateSpeed` can.
    const value = readCameraFieldValue(key, payload[key]);
    if (value !== undefined) data[key] = value;
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
 *
 * Returns null when the keyframe asks for nothing dispatchable — a `wait`, or a
 * track whose payload names no clip, tree or entity.
 */
export function buildCommand(
  trackType: CutsceneTrack['type'],
  entityId: string | null,
  keyframe: CutsceneKeyframe,
  /**
   * Raw playback progress through this keyframe's duration, 0..1. Only the
   * camera track reads it — see {@link STATE_TRACK_TYPES}. The keyframe's
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
  // Read against the track type's vocabulary before anything below touches it.
  // This is the dispatch boundary, and it does not get to assume its input came
  // from the generator: the store also takes keyframes from the timeline editor
  // and from a saved project, neither of which passes through the parse-time
  // check. What arrives here is `Record<string, unknown>` and nothing more.
  const payload = sanitizeKeyframePayload(trackType, keyframe.payload);

  switch (trackType) {
    case 'camera': {
      const cameraPayload = buildCameraCommandPayload(entityId, keyframe, prevKeyframe, progress);
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
      // Dialogue keyframes mutate the dialogue store directly via the dispatcher.
      // `beat` names which keyframe this dispatch came from: opening a dialogue is a
      // trigger, but a keyframe with a duration is re-dispatched every frame of its
      // window, so the handler needs to tell "the same beat again" from "a later
      // beat that happens to name the same tree". See `./dispatch.ts`.
      //
      // A `treeId` that is not a string is refused rather than forwarded. The
      // handler looks the tree up by that value, so a number or an object finds
      // nothing and the beat passes as if it had played; the command names a
      // real tree or it is not built.
      // Unlike the other tracks this one does not need an entity — a cutscene can
      // narrate without anyone speaking — but it does need a tree to start, and
      // `treeId` used to be forwarded unread, so a missing one started a dialogue
      // named `undefined`.
      const { treeId } = payload;
      if (typeof treeId !== 'string') return null;
      return {
        command: 'start_dialogue',
        payload: { treeId, entityId: entityId ?? undefined, beat: keyframe.timestamp },
      };
    }
    case 'audio': {
      if (!entityId) return null;
      // `volume` and `pitch` are read off the keyframe (see
      // `keyframePayload.ts`) and deliberately NOT dispatched. `handle_play_audio`
      // reads `entityId` and nothing else, so they reach nothing here — but the
      // obvious fix, prepending a `set_audio` with the two fields, is worse than
      // the gap it closes, for two independent reasons:
      //
      //   1. It would not be audible. Nothing in the web app ever creates an
      //      entity audio instance: `audioManager.createInstance` and
      //      `.setVolume` — the only places a gain node is assigned — have no
      //      production call site, so `audioManager.play(entityId)` (the one
      //      consumer of the engine's AUDIO_PLAYBACK event) always takes its
      //      `if (!instance)` branch and warns. Volume set engine-side reaches
      //      ECS state and stops there.
      //   2. It would mutate the project. `bridge/audio.rs:51-58` merges the
      //      partial into the entity's persisted `AudioData`, inserts
      //      `AudioEnabled`, and pushes an `UndoableAction::AudioChange` onto the
      //      editor `HistoryStack` — during playback. Ctrl-Z after watching a
      //      cutscene would undo the cutscene's writes instead of the user's last
      //      edit, and the volume the cutscene asked for would outlive it in the
      //      saved scene.
      //
      // So the audio track plays the sound and does not pretend to set its level.
      // Wiring entity audio through to the Web Audio graph, and giving playback a
      // command that is not scene-mutating, is PF-1155.
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
      // Re-derive the flags from the playhead rather than clearing them all.
      //
      // `currentTime` is not always 0 here: `seek()` on a stopped player moves the
      // playhead and correctly marks everything strictly before it as done. A
      // blanket reset then threw that away, and the first tick burst-fired every
      // beat from 0 up to the seek point at once. Same rule as `seek()`, so the
      // two agree; when the playhead is at 0 nothing is `< 0` and this is exactly
      // the reset it replaces.
      for (const item of this.scheduled) {
        item.fired = item.keyframe.timestamp < this.currentTime;
      }
    }

    useCutsceneStore.getState().setPlaybackState('playing');
    this.scheduleFrame();
  }

  /** Pause playback at the current position. */
  pause(): void {
    // Only a player that is actually running has a clock to freeze. Pausing one
    // that never played used to stamp `pausedAt` while `startTime` was still
    // null; the next `play()` took the resume branch, which cannot start a clock
    // that was never started, so `tick()` returned immediately on the null
    // `startTime` and never rescheduled. The player then sat at
    // `playbackState: 'playing'` with `isPlaying` true, firing nothing and never
    // calling `onComplete` — the same "stuck in Play" shape the keyframe error
    // boundary exists to prevent. This also makes a second `pause()` a no-op
    // instead of re-stamping the pause instant and swallowing the elapsed time.
    // `rafHandle !== null` is what `isPlaying` reads; spelled out here so the
    // handle narrows to a number for the cancel below.
    if (this.rafHandle === null) return;

    cancelAnimationFrame(this.rafHandle);
    this.rafHandle = null;
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

  /**
   * Seek to a specific time in seconds.
   *
   * What a seek must do with a keyframe it jumped over depends on whether that
   * keyframe was a trigger or a state — see {@link STATE_TRACK_TYPES}. A trigger
   * is suppressed: scrubbing forward past a `play_audio` keyframe must not fire
   * the sound the viewer has already heard (or, seeking backwards, has not
   * reached yet). A state has to be re-applied, because it describes what the
   * scene should LOOK like at the seek target, and nothing else will send it —
   * so those keyframes are left unfired and the next frame re-dispatches them in
   * timestamp order, last one winning. Marking them fired is what stranded the
   * camera on whatever state it happened to hold: seeking INTO a blend applied
   * it, seeking just PAST the same blend applied nothing.
   */
  seek(timeSecs: number): void {
    if (!this.cutscene) return;
    const clamped = Math.max(0, Math.min(timeSecs, this.cutscene.duration));
    this.currentTime = clamped;
    useCutsceneStore.getState().setPlaybackTime(clamped);
    // Strictly before, for the triggers: `fireKeyframesSafely` fires a keyframe
    // once the playhead REACHES its timestamp (`timestamp > time` is what it
    // skips), so a keyframe sitting exactly on the seek point is due, not done.
    // Marking it fired here — which is what `<=` did — made scrubbing precisely
    // onto a beat the one way to stop it playing.
    for (const item of this.scheduled) {
      item.fired = STATE_TRACK_TYPES.has(item.trackType)
        ? false
        : item.keyframe.timestamp < clamped;
    }
    if (this.startTime !== null) {
      this.startTime = performance.now() - clamped * 1000;
    }
    if (this.pausedAt !== null) {
      // Rebase the pause instant too. `startTime` above is stamped against NOW,
      // but `play()`'s resume branch adds `now - pausedAt` on top of it — so a
      // stale `pausedAt` charges the seek for however long the player sat paused
      // before it. Pause for ten seconds, seek to 3, resume, and the playhead
      // resumed at roughly -7: ten seconds of blank playback before the beat at 3.
      this.pausedAt = performance.now();
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
      this.fireKeyframesSafely(this.currentTime);
      this.rafHandle = null;
      useCutsceneStore.getState().setPlaybackState('idle');
      this.options.onComplete?.();
      return;
    }

    useCutsceneStore.getState().setPlaybackTime(this.currentTime);
    this.fireKeyframesSafely(this.currentTime);
    this.scheduleFrame();
  }

  /**
   * Fire a tick's keyframes without letting one bad keyframe end the playback.
   *
   * `scheduleFrame()` runs AFTER the fire call, so anything thrown out of a sink
   * used to take the rAF loop with it: the cutscene froze mid-play with
   * `isPlaying` still true, `onComplete` never ran, and the handler that returns
   * the engine to Edit mode never dispatched — leaving the editor stuck in Play.
   * One keyframe naming a tree that does not exist should cost that keyframe,
   * not the rest of the cutscene, so the error is reported and the playhead
   * moves on. A trigger keyframe is marked fired BEFORE dispatching, so a
   * throwing one is not retried on the next tick. An interpolating keyframe is
   * not, deliberately: it is re-dispatched every frame of its window by design,
   * and one bad frame of a camera blend should not abandon the blend.
   *
   * The boundary is per KEYFRAME, not per tick. Wrapping the whole loop reads as
   * equivalent — mid-playback it is, because the keyframes the throw skipped are
   * still unfired and the next tick picks them up. It stops being equivalent on
   * the terminal tick (`tick()` calls this once at `duration` and then ends the
   * rAF loop): there is no next tick, so every due keyframe ordered after a
   * throwing one at the end of the timeline would be silently dropped.
   */
  private fireKeyframesSafely(time: number): void {
    for (const item of this.scheduled) {
      if (item.keyframe.timestamp > time) continue;

      const elapsed = time - item.keyframe.timestamp;

      // A duration only means "step this over time" for a track whose command
      // sets a state. For everything else the duration describes how long the
      // triggered thing lasts, and re-triggering it each frame restarts it.
      const interpolates =
        item.keyframe.duration > 0 &&
        STATE_TRACK_TYPES.has(item.trackType) &&
        (item.trackType !== 'camera' || cameraKeyframeBlends(item));

      let progress = 1;
      if (interpolates) {
        // Re-fire every frame while within the window so that easing
        // interpolation is applied continuously. Once elapsed exceeds duration
        // AND progress=1.0 has already been dispatched, skip. The `fired` flag
        // ensures the final frame is dispatched even when rAF skips past the
        // exact end boundary.
        if (elapsed > item.keyframe.duration && item.fired) continue;
        progress = Math.min(elapsed / item.keyframe.duration, 1);
        if (progress >= 1) item.fired = true;
      } else {
        // One-shot keyframe: fire once only to avoid duplicate commands.
        if (item.fired) continue;
        item.fired = true;
      }

      try {
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
      } catch (err) {
        // Reported twice on purpose. The boundary's job is to SWALLOW the error,
        // and the user-visible symptom of a swallowed beat is "the thing didn't
        // happen" — nobody is going to have a console open when it does.
        console.error('[CutscenePlayer] Keyframe failed; continuing playback', err);
        captureException(err, {
          cutsceneId: this.cutscene?.id,
          trackId: item.trackId,
          trackType: item.trackType,
          timestamp: item.keyframe.timestamp,
        });
      }
    }
  }
}
