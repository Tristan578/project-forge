/**
 * Audio handlers for MCP commands.
 * Includes adaptive music, audio snapshots, occlusion, and horizontal re-sequencing.
 */

import { z } from 'zod';
import type { ToolHandler, ExecutionResult } from './types';
import { zEntityId, parseArgs } from './types';
import { audioManager } from '@/lib/audio/audioManager';
import { useMusicArrangementStore } from '@/lib/music/arrangementStore';

const zStem = z.object({
  name: z.string(),
  assetId: z.string(),
  baseVolume: z.number().optional(),
  intensityRange: z.tuple([z.number(), z.number()]).optional(),
});

export const audioHandlers: Record<string, ToolHandler> = {
  set_adaptive_music: async (args, ctx): Promise<ExecutionResult> => {
    try {
      const p = parseArgs(z.object({
        trackId: z.string().optional(),
        stems: z.array(zStem).min(1),
        bus: z.string().optional(),
        initialIntensity: z.number().optional(),
      }), args);
      if (p.error) return p.error;

      const id = p.data.trackId ?? 'default';
      audioManager.setAdaptiveMusic(id, p.data.stems, { bus: p.data.bus, initialIntensity: p.data.initialIntensity });
      ctx.store.setAdaptiveMusicIntensity(p.data.initialIntensity ?? 0);

      return {
        success: true,
        result: `Set up adaptive music track "${id}" with ${p.data.stems.length} stems: ${p.data.stems.map(s => s.name).join(', ')}`,
      };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to set adaptive music' };
    }
  },

  set_music_intensity: async (args, ctx): Promise<ExecutionResult> => {
    try {
      const p = parseArgs(z.object({
        trackId: z.string().optional(),
        intensity: z.number(),
        rampMs: z.number().positive().optional(),
      }), args);
      if (p.error) return p.error;

      const id = p.data.trackId ?? 'default';
      const clamped = Math.max(0, Math.min(1, p.data.intensity));
      audioManager.setMusicIntensity(id, clamped, p.data.rampMs);
      ctx.store.setAdaptiveMusicIntensity(clamped);

      return {
        success: true,
        result: `Set music intensity to ${clamped.toFixed(2)} for track "${id}"${p.data.rampMs ? ` (${p.data.rampMs}ms ramp)` : ''}`,
      };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to set music intensity' };
    }
  },

  transition_music_segment: async (args, ctx): Promise<ExecutionResult> => {
    try {
      const p = parseArgs(z.object({
        segment: z.string().min(1),
        crossfadeDurationMs: z.number().nonnegative().optional(),
      }), args);
      if (p.error) return p.error;

      ctx.store.setCurrentMusicSegment(p.data.segment);

      return {
        success: true,
        result: `Transitioned to music segment: ${p.data.segment}${p.data.crossfadeDurationMs ? ` (${p.data.crossfadeDurationMs}ms crossfade)` : ''}`,
      };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to transition music segment' };
    }
  },

  create_audio_snapshot: async (args, ctx): Promise<ExecutionResult> => {
    try {
      const p = parseArgs(z.object({
        name: z.string().min(1),
        crossfadeDurationMs: z.number().nonnegative().optional(),
      }), args);
      if (p.error) return p.error;

      ctx.store.saveAudioSnapshot(p.data.name, p.data.crossfadeDurationMs);

      return {
        success: true,
        result: `Created audio snapshot: ${p.data.name}`,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to create audio snapshot',
      };
    }
  },

  apply_audio_snapshot: async (args, ctx): Promise<ExecutionResult> => {
    try {
      const p = parseArgs(z.object({
        name: z.string().min(1),
        crossfadeDurationMs: z.number().nonnegative().optional(),
      }), args);
      if (p.error) return p.error;

      const snapshot = audioManager.getSnapshot(p.data.name);
      if (!snapshot) {
        return {
          success: false,
          error: `Audio snapshot not found: ${p.data.name}`,
        };
      }

      ctx.store.loadAudioSnapshot(p.data.name, p.data.crossfadeDurationMs);

      const duration = p.data.crossfadeDurationMs ?? snapshot.crossfadeDurationMs;
      return {
        success: true,
        result: `Applied audio snapshot: ${p.data.name} (${duration}ms crossfade)`,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to apply audio snapshot',
      };
    }
  },

  set_audio_occlusion: async (args, _ctx): Promise<ExecutionResult> => {
    try {
      const p = parseArgs(z.object({
        entityId: zEntityId,
        enabled: z.boolean().optional(),
      }), args);
      if (p.error) return p.error;

      const enabled = p.data.enabled ?? true;
      audioManager.setOcclusion(p.data.entityId, enabled);

      return {
        success: true,
        result: `Audio occlusion ${enabled ? 'enabled' : 'disabled'} for entity ${p.data.entityId}`,
      };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to set audio occlusion' };
    }
  },

  // ---------------------------------------------------------------------------
  // Music arrangement (music.FR-2.OP-01 / OP-02, #9854).
  //
  // The in-app AI half of the same operations the MusicArrangementPanel offers
  // manually. Both call the identical `useMusicArrangementStore` actions, so the
  // manual controls and the AI path share one validated command/data contract
  // and one undo/redo history — never two implementations of "trim a clip".
  // ---------------------------------------------------------------------------

  arrangement_add_track: async (args, _ctx): Promise<ExecutionResult> => {
    const p = parseArgs(z.object({ name: z.string().optional() }), args);
    if (p.error) return p.error;
    const trackId = useMusicArrangementStore.getState().addTrack(p.data.name);
    return { success: true, result: { trackId, message: `Added arrangement track ${trackId}.` } };
  },

  arrangement_delete_track: async (args, _ctx): Promise<ExecutionResult> => {
    const p = parseArgs(z.object({ trackId: z.string().min(1) }), args);
    if (p.error) return p.error;
    const store = useMusicArrangementStore.getState();
    if (!store.arrangement.tracks.some((t) => t.id === p.data.trackId)) {
      return { success: false, error: `Arrangement track not found: ${p.data.trackId}` };
    }
    store.deleteTrack(p.data.trackId);
    return { success: true, result: { message: `Deleted arrangement track ${p.data.trackId}.` } };
  },

  arrangement_set_track_muted: async (args, _ctx): Promise<ExecutionResult> => {
    const p = parseArgs(z.object({ trackId: z.string().min(1), muted: z.boolean() }), args);
    if (p.error) return p.error;
    const store = useMusicArrangementStore.getState();
    if (!store.arrangement.tracks.some((t) => t.id === p.data.trackId)) {
      return { success: false, error: `Arrangement track not found: ${p.data.trackId}` };
    }
    store.setTrackMuted(p.data.trackId, p.data.muted);
    return { success: true, result: { message: `Set mute on track ${p.data.trackId} to ${p.data.muted}.` } };
  },

  arrangement_add_clip: async (args, _ctx): Promise<ExecutionResult> => {
    const p = parseArgs(z.object({
      trackId: z.string().min(1),
      sourceUrl: z.string().min(1),
      sourceDurationSeconds: z.number(),
      startOffset: z.number().optional(),
      name: z.string().optional(),
    }), args);
    if (p.error) return p.error;
    const clipId = useMusicArrangementStore.getState().addClip({
      trackId: p.data.trackId,
      sourceUrl: p.data.sourceUrl,
      sourceDurationSeconds: p.data.sourceDurationSeconds,
      startOffset: p.data.startOffset,
      name: p.data.name,
    });
    if (clipId === null) {
      return { success: false, error: `Arrangement track not found: ${p.data.trackId}` };
    }
    return { success: true, result: { clipId, message: `Added clip ${clipId} to track ${p.data.trackId}.` } };
  },

  arrangement_move_clip: async (args, _ctx): Promise<ExecutionResult> => {
    const p = parseArgs(z.object({
      clipId: z.string().min(1),
      startOffset: z.number(),
      trackId: z.string().min(1).optional(),
    }), args);
    if (p.error) return p.error;
    const store = useMusicArrangementStore.getState();
    if (!store.arrangement.clips.some((c) => c.id === p.data.clipId)) {
      return { success: false, error: `Arrangement clip not found: ${p.data.clipId}` };
    }
    if (p.data.trackId !== undefined && !store.arrangement.tracks.some((t) => t.id === p.data.trackId)) {
      return { success: false, error: `Arrangement track not found: ${p.data.trackId}` };
    }
    store.moveClip(p.data.clipId, p.data.startOffset, p.data.trackId);
    return { success: true, result: { message: `Moved clip ${p.data.clipId}.` } };
  },

  arrangement_trim_clip: async (args, _ctx): Promise<ExecutionResult> => {
    const p = parseArgs(z.object({
      clipId: z.string().min(1),
      trimStart: z.number().optional(),
      trimEnd: z.number().optional(),
    }), args);
    if (p.error) return p.error;
    const store = useMusicArrangementStore.getState();
    if (!store.arrangement.clips.some((c) => c.id === p.data.clipId)) {
      return { success: false, error: `Arrangement clip not found: ${p.data.clipId}` };
    }
    store.trimClip(p.data.clipId, { trimStart: p.data.trimStart, trimEnd: p.data.trimEnd });
    return { success: true, result: { message: `Trimmed clip ${p.data.clipId}.` } };
  },

  arrangement_set_loop: async (args, _ctx): Promise<ExecutionResult> => {
    const p = parseArgs(z.object({
      clipId: z.string().min(1),
      loopEnabled: z.boolean(),
      trimStart: z.number().optional(),
      trimEnd: z.number().optional(),
    }), args);
    if (p.error) return p.error;
    const store = useMusicArrangementStore.getState();
    if (!store.arrangement.clips.some((c) => c.id === p.data.clipId)) {
      return { success: false, error: `Arrangement clip not found: ${p.data.clipId}` };
    }
    store.setLoopPoints(p.data.clipId, {
      loopEnabled: p.data.loopEnabled,
      trimStart: p.data.trimStart,
      trimEnd: p.data.trimEnd,
    });
    return { success: true, result: { message: `Set loop on clip ${p.data.clipId} to ${p.data.loopEnabled}.` } };
  },

  arrangement_delete_clip: async (args, _ctx): Promise<ExecutionResult> => {
    const p = parseArgs(z.object({ clipId: z.string().min(1) }), args);
    if (p.error) return p.error;
    const store = useMusicArrangementStore.getState();
    if (!store.arrangement.clips.some((c) => c.id === p.data.clipId)) {
      return { success: false, error: `Arrangement clip not found: ${p.data.clipId}` };
    }
    store.deleteClip(p.data.clipId);
    return { success: true, result: { message: `Deleted clip ${p.data.clipId}.` } };
  },

  arrangement_set_tempo: async (args, _ctx): Promise<ExecutionResult> => {
    const p = parseArgs(z.object({ bpm: z.number() }), args);
    if (p.error) return p.error;
    useMusicArrangementStore.getState().setTempoBpm(p.data.bpm);
    const tempoBpm = useMusicArrangementStore.getState().arrangement.tempoBpm;
    return { success: true, result: { tempoBpm, message: `Set arrangement tempo to ${tempoBpm} BPM.` } };
  },
};
