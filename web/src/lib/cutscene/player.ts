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
 * Translate a keyframe payload into an engine command for the given track type.
 * Returns null if the track type is 'wait' (no command to dispatch).
 */
export function buildCommand(
  trackType: CutsceneTrack['type'],
  entityId: string | null,
  keyframe: CutsceneKeyframe,
  progress: number,
): { command: string; payload: unknown } | null {
  const { payload } = keyframe;
  const easedProgress = applyEasing(progress, keyframe.easing);

  switch (trackType) {
    case 'camera': {
      return {
        command: 'set_game_camera',
        payload: { ...payload, entityId: entityId ?? undefined, _easedProgress: easedProgress },
      };
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
      // Dialogue keyframes mutate the dialogue store directly via the dispatcher
      return {
        command: 'start_dialogue',
        payload: { treeId: payload.treeId, entityId: entityId ?? undefined },
      };
    }
    case 'audio': {
      if (!entityId) return null;
      return {
        command: 'play_audio',
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
