/**
 * Audio handlers for core entity audio commands, bus management, layering, transitions,
 * reverb zones, and ducking rules. Migrated from executor.legacy.ts.
 */

import type { ToolHandler } from './types';

export const audioLegacyHandlers: Record<string, ToolHandler> = {
  set_audio: async (args, { store }) => {
    const entityId = args.entityId as string;
    if (!entityId) return { success: false, error: 'Missing entityId' };
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
    store.setAudio(entityId, audioData);
    return { success: true, result: { message: `Audio set on ${entityId}` } };
  },

  remove_audio: async (args, { store }) => {
    const entityId = args.entityId as string;
    if (!entityId) return { success: false, error: 'Missing entityId' };
    store.removeAudio(entityId);
    return { success: true, result: { message: `Audio removed from ${entityId}` } };
  },

  play_audio: async (args, { store }) => {
    const entityId = args.entityId as string;
    if (!entityId) return { success: false, error: 'Missing entityId' };
    store.playAudio(entityId);
    return { success: true, result: { message: `Playing audio on ${entityId}` } };
  },

  stop_audio: async (args, { store }) => {
    const entityId = args.entityId as string;
    if (!entityId) return { success: false, error: 'Missing entityId' };
    store.stopAudio(entityId);
    return { success: true, result: { message: `Stopped audio on ${entityId}` } };
  },

  pause_audio: async (args, { store }) => {
    const entityId = args.entityId as string;
    if (!entityId) return { success: false, error: 'Missing entityId' };
    store.pauseAudio(entityId);
    return { success: true, result: { message: `Paused audio on ${entityId}` } };
  },

  get_audio: async (args, { store }) => {
    const entityId = args.entityId as string;
    if (!entityId) return { success: false, error: 'Missing entityId' };
    const audio = store.primaryAudio;
    if (!audio) return { success: true, result: { hasAudio: false } };
    return { success: true, result: { hasAudio: true, ...audio } };
  },

  update_audio_bus: async (args, { store }) => {
    const busName = args.busName as string;
    if (!busName) return { success: false, error: 'Missing busName' };
    const update: Record<string, unknown> = {};
    if (args.volume !== undefined) update.volume = args.volume;
    if (args.muted !== undefined) update.muted = args.muted;
    if (args.soloed !== undefined) update.soloed = args.soloed;
    store.updateAudioBus(busName, update);
    return { success: true, result: { message: `Updated bus: ${busName}` } };
  },

  create_audio_bus: async (args, { store }) => {
    const name = args.name as string;
    if (!name) return { success: false, error: 'Missing name' };
    const volume = (args.volume as number) ?? 1.0;
    store.createAudioBus(name, volume);
    return { success: true, result: { message: `Created bus: ${name}` } };
  },

  delete_audio_bus: async (args, { store }) => {
    const busName = args.busName as string;
    if (!busName) return { success: false, error: 'Missing busName' };
    store.deleteAudioBus(busName);
    return { success: true, result: { message: `Deleted bus: ${busName}` } };
  },

  get_audio_buses: async (_args, { store }) => {
    return {
      success: true,
      result: { buses: store.audioBuses, count: store.audioBuses.length },
    };
  },

  set_bus_effects: async (args, { store }) => {
    const busName = args.busName as string;
    const effects = args.effects as Array<{ effectType: string; params: Record<string, number>; enabled: boolean }>;
    if (!busName || !effects) return { success: false, error: 'Missing busName or effects' };
    store.setBusEffects(busName, effects);
    return { success: true, result: { message: `Set effects on bus: ${busName}`, effectCount: effects.length } };
  },

  audio_crossfade: async (args, { store }) => {
    const fromEntityId = args.fromEntityId as string;
    const toEntityId = args.toEntityId as string;
    const durationMs = args.durationMs as number;
    if (!fromEntityId || !toEntityId) return { success: false, error: 'Missing fromEntityId or toEntityId' };
    store.crossfadeAudio(fromEntityId, toEntityId, durationMs ?? 1000);
    return { success: true, result: { message: `Crossfading from ${fromEntityId} to ${toEntityId}` } };
  },

  audio_fade_in: async (args, { store }) => {
    const entityId = args.entityId as string;
    const durationMs = args.durationMs as number;
    if (!entityId) return { success: false, error: 'Missing entityId' };
    store.fadeInAudio(entityId, durationMs ?? 1000);
    return { success: true, result: { message: `Fading in audio on ${entityId}` } };
  },

  audio_fade_out: async (args, { store }) => {
    const entityId = args.entityId as string;
    const durationMs = args.durationMs as number;
    if (!entityId) return { success: false, error: 'Missing entityId' };
    store.fadeOutAudio(entityId, durationMs ?? 1000);
    return { success: true, result: { message: `Fading out audio on ${entityId}` } };
  },

  audio_play_one_shot: async (args, { store }) => {
    const assetId = args.assetId as string;
    if (!assetId) return { success: false, error: 'Missing assetId' };
    store.playOneShotAudio(assetId, {
      position: args.position as [number, number, number] | undefined,
      bus: args.bus as string | undefined,
      volume: args.volume as number | undefined,
      pitch: args.pitch as number | undefined,
    });
    return { success: true, result: { message: `Playing one-shot: ${assetId}` } };
  },

  audio_add_layer: async (args, { store }) => {
    const entityId = args.entityId as string;
    const slotName = args.slotName as string;
    const assetId = args.assetId as string;
    if (!entityId || !slotName || !assetId) return { success: false, error: 'Missing required params' };
    store.addAudioLayer(entityId, slotName, assetId, {
      volume: args.volume as number | undefined,
      loop: args.loop as boolean | undefined,
      bus: args.bus as string | undefined,
    });
    return { success: true, result: { message: `Added audio layer "${slotName}" to ${entityId}` } };
  },

  audio_remove_layer: async (args, { store }) => {
    const entityId = args.entityId as string;
    const slotName = args.slotName as string;
    if (!entityId || !slotName) return { success: false, error: 'Missing entityId or slotName' };
    store.removeAudioLayer(entityId, slotName);
    return { success: true, result: { message: `Removed audio layer "${slotName}" from ${entityId}` } };
  },

  set_ducking_rule: async (args, { store }) => {
    const triggerBus = args.triggerBus as string;
    const targetBus = args.targetBus as string;
    if (!triggerBus || !targetBus) return { success: false, error: 'Missing triggerBus or targetBus' };
    store.setDuckingRule({
      triggerBus,
      targetBus,
      duckLevel: args.duckLevel as number | undefined,
      attackMs: args.attackMs as number | undefined,
      releaseMs: args.releaseMs as number | undefined,
    });
    return { success: true, result: { message: `Ducking rule set: ${triggerBus} -> ${targetBus}` } };
  },

  set_reverb_zone: async (args, { store }) => {
    const entityId = args.entityId as string;
    if (!entityId) return { success: false, error: 'Missing entityId' };

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

    const current = store.reverbZones[entityId];
    const shapeData = shape === 'sphere'
      ? { type: 'sphere' as const, radius: radius ?? 5 }
      : { type: 'box' as const, size: [sizeX ?? 10, sizeY ?? 5, sizeZ ?? 10] as [number, number, number] };

    store.updateReverbZone(entityId, {
      shape: shapeData,
      preset: reverbType ?? current?.preset ?? 'hall',
      wetMix: wetMix ?? current?.wetMix ?? 0.5,
      decayTime: decayTime ?? current?.decayTime ?? 2.0,
      preDelay: preDelay ?? current?.preDelay ?? 20,
      blendRadius: current?.blendRadius ?? 2.0,
      priority: priority ?? current?.priority ?? 0,
    });
    return { success: true, result: { message: `Reverb zone set on ${entityId}` } };
  },

  remove_reverb_zone: async (args, { store }) => {
    const entityId = args.entityId as string;
    if (!entityId) return { success: false, error: 'Missing entityId' };
    store.removeReverbZone(entityId);
    return { success: true, result: { message: `Reverb zone removed from ${entityId}` } };
  },

  set_music_stems: async (_args, _ctx) => {
    return { success: true, result: { message: 'Music stems configured' } };
  },
};
