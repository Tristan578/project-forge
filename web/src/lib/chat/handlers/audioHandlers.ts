/**
 * Audio handlers for MCP commands.
 * Includes adaptive music, audio snapshots, occlusion, and horizontal re-sequencing.
 */

import { z } from 'zod';
import type { ToolHandler, ExecutionResult } from './types';
import { zEntityId, parseArgs } from './types';
import { audioManager } from '@/lib/audio/audioManager';

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
        crossfadeDurationMs: z.number().positive().optional(),
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
        crossfadeDuration: z.number().positive().optional(),
      }), args);
      if (p.error) return p.error;

      ctx.store.saveAudioSnapshot(p.data.name, p.data.crossfadeDuration);

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
        crossfadeDurationMs: z.number().positive().optional(),
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

      const duration = p.data.crossfadeDurationMs ?? snapshot.crossfadeDuration;
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
};
