/**
 * Audio handlers for core entity audio commands, bus management, layering, transitions,
 * reverb zones, and ducking rules. Migrated from executor.legacy.ts.
 */

import { z } from 'zod';
import type { ToolHandler } from './types';
import { zEntityId, parseArgs } from './types';

export const audioLegacyHandlers: Record<string, ToolHandler> = {
  set_audio: async (args, { store }) => {
    const p = parseArgs(z.object({ entityId: zEntityId }), args);
    if (p.error) return p.error;
    const audioData: Record<string, unknown> = {};
    if (args.assetId !== undefined) audioData.assetId = args.assetId;
    if (args.volume !== undefined) audioData.volume = args.volume;
    if (args.pitch !== undefined) audioData.pitch = args.pitch;
    if (args.loopAudio !== undefined) audioData.loopAudio = args.loopAudio;
    if (args.spatial !== undefined) audioData.spatial = args.spatial;
    if (args.maxDistance !== undefined) audioData.maxDistance = args.maxDistance;
    if (args.refDistance !== undefined) audioData.refDistance = args.refDistance;
    if (args.rolloffFactor !== undefined) audioData.rolloffFactor = args.rolloffFactor;
    if (args.autoplay !== undefined) audioData.autoplay = args.autoplay;
    store.setAudio(p.data.entityId, audioData);
    return { success: true, result: { message: `Audio set on ${p.data.entityId}` } };
  },

  remove_audio: async (args, { store }) => {
    const p = parseArgs(z.object({ entityId: zEntityId }), args);
    if (p.error) return p.error;
    store.removeAudio(p.data.entityId);
    return { success: true, result: { message: `Audio removed from ${p.data.entityId}` } };
  },

  play_audio: async (args, { store }) => {
    const p = parseArgs(z.object({ entityId: zEntityId }), args);
    if (p.error) return p.error;
    store.playAudio(p.data.entityId);
    return { success: true, result: { message: `Playing audio on ${p.data.entityId}` } };
  },

  stop_audio: async (args, { store }) => {
    const p = parseArgs(z.object({ entityId: zEntityId }), args);
    if (p.error) return p.error;
    store.stopAudio(p.data.entityId);
    return { success: true, result: { message: `Stopped audio on ${p.data.entityId}` } };
  },

  pause_audio: async (args, { store }) => {
    const p = parseArgs(z.object({ entityId: zEntityId }), args);
    if (p.error) return p.error;
    store.pauseAudio(p.data.entityId);
    return { success: true, result: { message: `Paused audio on ${p.data.entityId}` } };
  },

  get_audio: async (args, { store }) => {
    const p = parseArgs(z.object({ entityId: zEntityId }), args);
    if (p.error) return p.error;
    const audio = store.primaryAudio;
    if (!audio) return { success: true, result: { hasAudio: false } };
    return { success: true, result: { hasAudio: true, ...audio } };
  },

  update_audio_bus: async (args, { store }) => {
    const p = parseArgs(z.object({ busName: z.string().min(1) }), args);
    if (p.error) return p.error;
    const update: Record<string, unknown> = {};
    if (args.volume !== undefined) update.volume = args.volume;
    if (args.muted !== undefined) update.muted = args.muted;
    if (args.soloed !== undefined) update.soloed = args.soloed;
    store.updateAudioBus(p.data.busName, update);
    return { success: true, result: { message: `Updated bus: ${p.data.busName}` } };
  },

  create_audio_bus: async (args, { store }) => {
    const p = parseArgs(
      z.object({ name: z.string().min(1), volume: z.number().optional() }),
      args,
    );
    if (p.error) return p.error;
    store.createAudioBus(p.data.name, p.data.volume ?? 1.0);
    return { success: true, result: { message: `Created bus: ${p.data.name}` } };
  },

  delete_audio_bus: async (args, { store }) => {
    const p = parseArgs(z.object({ busName: z.string().min(1) }), args);
    if (p.error) return p.error;
    store.deleteAudioBus(p.data.busName);
    return { success: true, result: { message: `Deleted bus: ${p.data.busName}` } };
  },

  get_audio_buses: async (_args, { store }) => {
    return {
      success: true,
      result: { buses: store.audioBuses, count: store.audioBuses.length },
    };
  },

  set_bus_effects: async (args, { store }) => {
    const p = parseArgs(
      z.object({
        busName: z.string().min(1),
        effects: z.array(
          z.object({
            effectType: z.string(),
            params: z.record(z.string(), z.number()),
            enabled: z.boolean(),
          }),
        ),
      }),
      args,
    );
    if (p.error) return p.error;
    store.setBusEffects(p.data.busName, p.data.effects);
    return {
      success: true,
      result: { message: `Set effects on bus: ${p.data.busName}`, effectCount: p.data.effects.length },
    };
  },

  audio_crossfade: async (args, { store }) => {
    const p = parseArgs(
      z.object({
        fromEntityId: zEntityId,
        toEntityId: zEntityId,
        durationMs: z.number().optional(),
      }),
      args,
    );
    if (p.error) return p.error;
    store.crossfadeAudio(p.data.fromEntityId, p.data.toEntityId, p.data.durationMs ?? 1000);
    return {
      success: true,
      result: { message: `Crossfading from ${p.data.fromEntityId} to ${p.data.toEntityId}` },
    };
  },

  audio_fade_in: async (args, { store }) => {
    const p = parseArgs(
      z.object({ entityId: zEntityId, durationMs: z.number().optional() }),
      args,
    );
    if (p.error) return p.error;
    store.fadeInAudio(p.data.entityId, p.data.durationMs ?? 1000);
    return { success: true, result: { message: `Fading in audio on ${p.data.entityId}` } };
  },

  audio_fade_out: async (args, { store }) => {
    const p = parseArgs(
      z.object({ entityId: zEntityId, durationMs: z.number().optional() }),
      args,
    );
    if (p.error) return p.error;
    store.fadeOutAudio(p.data.entityId, p.data.durationMs ?? 1000);
    return { success: true, result: { message: `Fading out audio on ${p.data.entityId}` } };
  },

  audio_play_one_shot: async (args, { store }) => {
    const p = parseArgs(
      z.object({
        assetId: z.string().min(1),
        position: z.tuple([z.number(), z.number(), z.number()]).optional(),
        bus: z.string().optional(),
        volume: z.number().optional(),
        pitch: z.number().optional(),
      }),
      args,
    );
    if (p.error) return p.error;
    store.playOneShotAudio(p.data.assetId, {
      position: p.data.position,
      bus: p.data.bus,
      volume: p.data.volume,
      pitch: p.data.pitch,
    });
    return { success: true, result: { message: `Playing one-shot: ${p.data.assetId}` } };
  },

  audio_add_layer: async (args, { store }) => {
    const p = parseArgs(
      z.object({
        entityId: zEntityId,
        slotName: z.string().min(1),
        assetId: z.string().min(1),
        volume: z.number().optional(),
        loop: z.boolean().optional(),
        bus: z.string().optional(),
      }),
      args,
    );
    if (p.error) return p.error;
    store.addAudioLayer(p.data.entityId, p.data.slotName, p.data.assetId, {
      volume: p.data.volume,
      loop: p.data.loop,
      bus: p.data.bus,
    });
    return {
      success: true,
      result: { message: `Added audio layer "${p.data.slotName}" to ${p.data.entityId}` },
    };
  },

  audio_remove_layer: async (args, { store }) => {
    const p = parseArgs(
      z.object({ entityId: zEntityId, slotName: z.string().min(1) }),
      args,
    );
    if (p.error) return p.error;
    store.removeAudioLayer(p.data.entityId, p.data.slotName);
    return {
      success: true,
      result: { message: `Removed audio layer "${p.data.slotName}" from ${p.data.entityId}` },
    };
  },

  set_ducking_rule: async (args, { store }) => {
    const p = parseArgs(
      z.object({
        triggerBus: z.string().min(1),
        targetBus: z.string().min(1),
        duckLevel: z.number().optional(),
        attackMs: z.number().optional(),
        releaseMs: z.number().optional(),
      }),
      args,
    );
    if (p.error) return p.error;
    store.setDuckingRule({
      triggerBus: p.data.triggerBus,
      targetBus: p.data.targetBus,
      duckLevel: p.data.duckLevel,
      attackMs: p.data.attackMs,
      releaseMs: p.data.releaseMs,
    });
    return {
      success: true,
      result: { message: `Ducking rule set: ${p.data.triggerBus} -> ${p.data.targetBus}` },
    };
  },

  set_reverb_zone: async (args, { store }) => {
    const p = parseArgs(z.object({ entityId: zEntityId }), args);
    if (p.error) return p.error;

    const shape = args.shape as string | undefined;
    const sizeX = args.sizeX as number | undefined;
    const sizeY = args.sizeY as number | undefined;
    const sizeZ = args.sizeZ as number | undefined;
    const radius = args.radius as number | undefined;
    const reverbType = args.reverbType as string | undefined;
    const wetMix = args.wetMix as number | undefined;
    const decayTime = args.decayTime as number | undefined;
    const preDelay = args.preDelay as number | undefined;
    const priority = args.priority as number | undefined;

    const current = store.reverbZones[p.data.entityId];
    const shapeData = shape === 'sphere'
      ? { type: 'sphere' as const, radius: radius ?? 5 }
      : { type: 'box' as const, size: [sizeX ?? 10, sizeY ?? 5, sizeZ ?? 10] as [number, number, number] };

    store.updateReverbZone(p.data.entityId, {
      shape: shapeData,
      preset: reverbType ?? current?.preset ?? 'hall',
      wetMix: wetMix ?? current?.wetMix ?? 0.5,
      decayTime: decayTime ?? current?.decayTime ?? 2.0,
      preDelay: preDelay ?? current?.preDelay ?? 20,
      blendRadius: current?.blendRadius ?? 2.0,
      priority: priority ?? current?.priority ?? 0,
    });
    return { success: true, result: { message: `Reverb zone set on ${p.data.entityId}` } };
  },

  remove_reverb_zone: async (args, { store }) => {
    const p = parseArgs(z.object({ entityId: zEntityId }), args);
    if (p.error) return p.error;
    store.removeReverbZone(p.data.entityId);
    return { success: true, result: { message: `Reverb zone removed from ${p.data.entityId}` } };
  },

  set_music_stems: async (args, _ctx) => {
    try {
      const p = parseArgs(
        z.object({
          trackId: z.string().optional(),
          stems: z.array(
            z.object({
              name: z.string(),
              assetId: z.string(),
              baseVolume: z.number().optional(),
              intensityRange: z.tuple([z.number(), z.number()]).optional(),
            }),
          ).min(1),
        }),
        args,
      );
      if (p.error) return p.error;

      const { audioManager } = await import('@/lib/audio/audioManager');
      const id = p.data.trackId ?? 'default';
      audioManager.setAdaptiveMusic(id, p.data.stems);

      return { success: true, result: { message: `Set ${p.data.stems.length} music stems for track "${id}"` } };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Failed to set music stems' };
    }
  },
};
