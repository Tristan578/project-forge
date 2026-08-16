/**
 * CutscenePlayer — rAF-based command scheduler for cutscene playback.
 *
 * Walks each track's keyframes and performs what they ask for when the playback
 * clock reaches them. Camera, animation and audio route through the existing
 * engine command pipeline — no new Rust systems required. Dialogue does not:
 * there is no engine command that starts one, so it goes to the dialogue store,
 * which is where the script runtime starts dialogues from too.
 *
 * A keyframe is not necessarily one command — see `CutsceneAction`.
 */

import type { Cutscene, CutsceneTrack, CutsceneKeyframe } from '@/stores/cutsceneStore';
import { useCutsceneStore } from '@/stores/cutsceneStore';
import { useDialogueStore } from '@/stores/dialogueStore';
import { captureException } from '@/lib/monitoring/sentry-client';
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

/**
 * One thing a keyframe asks for when it fires.
 *
 * A keyframe is not one engine command. An audio beat is two (`set_audio` to
 * carry the volume and pitch, then `play_audio` to start it), and a dialogue
 * beat is not an engine command at all — starting a dialogue is a store action.
 * Modelling that as data rather than as calls keeps `buildActions` pure, so the
 * tests assert on what a keyframe asks for without standing up a store or a
 * dispatcher.
 */
export type CutsceneAction =
  | { kind: 'command'; command: string; payload: unknown }
  | { kind: 'dialogue'; treeId: string };

/*
 * Every keyframe fires ONCE, when the playhead reaches its timestamp. A
 * keyframe's `duration` describes how long its beat occupies the timeline, not
 * how long to keep dispatching.
 *
 * `fireKeyframesSafely` used to re-fire any duration-bearing keyframe every frame,
 * which is wrong for every track this player has:
 *
 *   - `play_animation`, `play_audio` and `startDialogue` are TRIGGERS. Re-firing
 *     restarts the thing they name, so a two-second keyframe on any of them
 *     never advanced past its first instant.
 *   - `set_game_camera` looks like a state — an absolute set that ought to be
 *     idempotent — and an earlier revision of this file kept it continuous on
 *     exactly that reasoning. The engine says otherwise.
 *     `engine/src/bridge/game.rs:159-163` rebuilds the component as
 *     `GameCameraData { mode, target_entity, ..Default::default() }`, zeroing
 *     `shake_intensity`/`shake_duration`/`shake_timer`, and `:168-176`
 *     re-inserts `OrbitalState::default()` / `FirstPersonState::default()`.
 *     `cutsceneHandlers.ts` dispatches `play` before building this player, so
 *     `PlaySystemSet` is live during playback: re-firing zeroed the orbital
 *     angle accumulated at `core/game_camera.rs:594` and the first-person
 *     yaw/pitch on every tick, and cancelled any in-flight camera shake.
 *
 * So the one track that was kept continuous was the one where re-firing was
 * destructive, and it bought nothing: `set_game_camera` carries no progress
 * (see `buildActions`), so every re-fire dispatched a byte-identical payload.
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
 * unsanitized payload. `buildActions` sanitizes first, so every own-key guard
 * below is unreachable through it — testing them through `buildActions` yields
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
 * Translate a keyframe into the list of actions it asks for.
 *
 * Returns an empty list when the keyframe asks for nothing actionable — a
 * `wait`, or a track whose payload names no clip, tree or entity. Callers fire
 * every action in order.
 *
 * Takes no playback progress. The camera command used to carry an
 * `_easedProgress` field, which no engine command has ever read and nothing on
 * the JS side consumed either — so easing a camera keyframe has always been a
 * no-op. Real interpolation would mean lerping JS-side between the camera's
 * current and target state and dispatching each step, since `set_game_camera`
 * has no interpolation of its own; that is a different function with a
 * different shape, and `applyEasing` is the seam it will use. Threading a
 * parameter that is structurally always `1` in the meantime would be an
 * argument the receiver never reads — the same shape as the bugs this module
 * exists to remove.
 */
export function buildActions(
  trackType: CutsceneTrack['type'],
  entityId: string | null,
  keyframe: CutsceneKeyframe,
): CutsceneAction[] {
  // Read against the track type's vocabulary before anything below touches it.
  // This is the dispatch boundary, and it does not get to assume its input came
  // from the generator: the store also takes keyframes from the timeline editor
  // and from a saved project, neither of which passes through the parse-time
  // check. What arrives here is `Record<string, unknown>` and nothing more.
  const payload = sanitizeKeyframePayload(trackType, keyframe.payload);

  switch (trackType) {
    case 'camera': {
      const cameraPayload = buildCameraCommandPayload(entityId, payload);
      if (!cameraPayload) return [];
      return [{ kind: 'command', command: 'set_game_camera', payload: cameraPayload }];
    }
    case 'animation': {
      if (!entityId) return [];
      // No clip names nothing to play. This used to fall back to `''` and
      // dispatch anyway — a `play_animation` for the empty clip, which the
      // engine can only ignore, indistinguishable in a log from one that worked.
      const { clipName } = payload;
      if (typeof clipName !== 'string') return [];
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
      return [{ kind: 'command', command: 'play_animation', payload: animationPayload }];
    }
    case 'dialogue': {
      // Unlike the other tracks this one does not need an entity — a cutscene can
      // narrate without anyone speaking — but it does need a tree to start, and
      // `treeId` used to be forwarded unread, so a missing one started a dialogue
      // named `undefined`.
      const { treeId } = payload;
      if (typeof treeId !== 'string') return [];
      // Not an engine command. This used to dispatch `start_dialogue`, which no
      // arm in `engine/src/core/commands/` has ever handled and nothing JS-side
      // intercepted either — the dispatcher handed to this player is the raw
      // engine dispatcher, so `handle_command` answered with an `Err` that
      // `dispatchCommand` (returning `void`) discarded. Starting a dialogue is a
      // store action, which is how the script runtime has always done it.
      //
      // `entityId` is dropped rather than carried: `startDialogue` takes a tree
      // and nothing else. Passing a speaker would need the store to hold one,
      // which it does not — inventing a second argument here would be a field
      // the receiver never reads, the same shape as the bug being fixed.
      return [{ kind: 'dialogue', treeId }];
    }
    case 'audio': {
      if (!entityId) return [];
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
      return [{ kind: 'command', command: 'play_audio', payload: { entityId } }];
    }
    case 'wait':
      return [];
    default:
      return [];
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

  /** Seek to a specific time in seconds. */
  seek(timeSecs: number): void {
    if (!this.cutscene) return;
    const clamped = Math.max(0, Math.min(timeSecs, this.cutscene.duration));
    this.currentTime = clamped;
    useCutsceneStore.getState().setPlaybackTime(clamped);
    // Re-mark keyframes before the seek point as fired so they don't replay.
    //
    // Strictly before: `fireKeyframesSafely` fires a keyframe once the playhead
    // REACHES its timestamp (`timestamp > time` is what it skips), so a keyframe
    // sitting exactly on the seek point is due, not done. Marking it fired here
    // — which is what `<=` did — meant scrubbing precisely onto a beat was the
    // one way to make it never play. It went unnoticed while duration-bearing
    // keyframes re-fired every frame and the flag was re-cleared a frame later;
    // now that every track fires once, `fired` is the only gate there is.
    for (const item of this.scheduled) {
      item.fired = item.keyframe.timestamp < clamped;
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
   * moves on. Each keyframe is marked fired BEFORE firing, so a throwing
   * keyframe is not retried on the next tick.
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
      // Every track fires once; `duration` bounds the beat, not the dispatching.
      // See the note above `buildActions` for why re-firing is wrong on all four.
      if (item.fired) continue;
      item.fired = true;
      try {
        this.fire(item);
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

  /** Perform everything one keyframe asks for, in the order it asked. */
  private fire(item: ScheduledKeyframe): void {
    for (const action of buildActions(item.trackType, item.entityId, item.keyframe)) {
      if (action.kind === 'command') {
        this.options.dispatchCommand(action.command, action.payload);
      } else {
        // Read at call time, not captured at construction. The player is built
        // once per playback and the store is a live singleton — holding onto
        // `getState()` would pin the actions as they were when playback started.
        useDialogueStore.getState().startDialogue(action.treeId);
      }
    }
  }
}
