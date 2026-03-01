/**
 * Audio handlers for MCP commands.
 * Includes adaptive music, audio snapshots, occlusion, and horizontal re-sequencing.
 */

import type { ToolHandler, ExecutionResult } from './types';
import { audioManager } from '@/lib/audio/audioManager';

export const audioHandlers: Record<string, ToolHandler> = {
  set_adaptive_music: async (args, ctx): Promise<ExecutionResult> => {
    try {
      const { trackId, stems, bus, initialIntensity } = args as {
        trackId?: string;
        stems: Array<{ name: string; assetId: string; baseVolume?: number; intensityRange?: [number, number] }>;
        bus?: string;
        initialIntensity?: number;
      };

      if (!stems || !Array.isArray(stems) || stems.length === 0) {
        return { success: false, error: 'Missing required parameter: stems (array of { name, assetId })' };
      }

      const id = trackId ?? 'default';
      audioManager.setAdaptiveMusic(id, stems, { bus, initialIntensity });
      ctx.store.setAdaptiveMusicIntensity(initialIntensity ?? 0);

      return {
        success: true,
        result: `Set up adaptive music track "${id}" with ${stems.length} stems: ${stems.map(s => s.name).join(', ')}`,
      };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to set adaptive music' };
    }
  },

  set_music_intensity: async (args, ctx): Promise<ExecutionResult> => {
    try {
      const { trackId, intensity, rampMs } = args as {
        trackId?: string;
        intensity: number;
        rampMs?: number;
      };

      if (intensity === undefined || intensity === null) {
        return { success: false, error: 'Missing required parameter: intensity (0.0 to 1.0)' };
      }

      const id = trackId ?? 'default';
      const clamped = Math.max(0, Math.min(1, intensity));
      audioManager.setMusicIntensity(id, clamped, rampMs);
      ctx.store.setAdaptiveMusicIntensity(clamped);

      return {
        success: true,
        result: `Set music intensity to ${clamped.toFixed(2)} for track "${id}"${rampMs ? ` (${rampMs}ms ramp)` : ''}`,
      };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to set music intensity' };
    }
  },

  transition_music_segment: async (args, ctx): Promise<ExecutionResult> => {
    try {
      const { segment, crossfadeDurationMs } = args as {
        segment: string;
        crossfadeDurationMs?: number;
      };

      if (!segment) {
        return { success: false, error: 'Missing required parameter: segment' };
      }

      ctx.store.setCurrentMusicSegment(segment);

      return {
        success: true,
        result: `Transitioned to music segment: ${segment}${crossfadeDurationMs ? ` (${crossfadeDurationMs}ms crossfade)` : ''}`,
      };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to transition music segment' };
    }
  },

  create_audio_snapshot: async (args, ctx): Promise<ExecutionResult> => {
    try {
      const { name } = args as { name: string };

      // Capture current audio state
      const snapshot = {
        name,
        buses: ctx.store.audioBuses.map(bus => ({
          name: bus.name,
          volume: audioManager.getBusVolume(bus.name),
          muted: audioManager.isBusMuted(bus.name),
          effects: bus.effects,
        })),
        timestamp: Date.now(),
      };

      // Store in local storage (or could be in zustand)
      const snapshots = JSON.parse(localStorage.getItem('audioSnapshots') || '[]');
      snapshots.push(snapshot);
      localStorage.setItem('audioSnapshots', JSON.stringify(snapshots));

      return {
        success: true,
        result: `Created audio snapshot: ${name}`,
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
      const { name, crossfadeDurationMs } = args as { name: string; crossfadeDurationMs?: number };

      // Load snapshot
      const snapshots = JSON.parse(localStorage.getItem('audioSnapshots') || '[]');
      const snapshot = snapshots.find((s: { name: string }) => s.name === name);

      if (!snapshot) {
        return {
          success: false,
          error: `Audio snapshot not found: ${name}`,
        };
      }

      const duration = crossfadeDurationMs ?? 1000;
      const durationSec = duration / 1000;

      // Apply bus volumes with crossfade
      for (const bus of snapshot.buses) {
        // Animate volume change
        setTimeout(() => {
          audioManager.setBusVolume(bus.name, bus.volume);
          audioManager.muteBus(bus.name, bus.muted);
        }, durationSec);

        // Update store
        ctx.store.updateAudioBus(bus.name, { volume: bus.volume, muted: bus.muted });
        if (bus.effects) {
          ctx.store.setBusEffects(bus.name, bus.effects);
        }
      }

      return {
        success: true,
        result: `Applied audio snapshot: ${name} (${duration}ms crossfade)`,
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
      const { entityId, enabled } = args as { entityId: string; enabled: boolean };

      if (!entityId) {
        return { success: false, error: 'Missing required parameter: entityId' };
      }

      audioManager.setOcclusion(entityId, enabled ?? true);

      return {
        success: true,
        result: `Audio occlusion ${enabled ? 'enabled' : 'disabled'} for entity ${entityId}`,
      };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to set audio occlusion' };
    }
  },
};
