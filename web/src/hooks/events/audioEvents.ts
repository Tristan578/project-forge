/**
 * Event handlers for scripts, audio, audio buses, reverb zones.
 */

import { useEditorStore, type ScriptData, type AudioBusDef, type ReverbZoneData, type ReverbShape, type InputBinding, type InputPreset, type AssetMetadata } from '@/stores/editorStore';
import type { SetFn, GetFn } from './types';

export function handleAudioEvent(
  type: string,
  data: Record<string, unknown>,
  _set: SetFn,
  _get: GetFn
): boolean {
  switch (type) {
    case 'SCRIPT_CHANGED': {
      const payload = data as unknown as { entityId: string; source: string; enabled: boolean; template: string | null };
      const script: ScriptData = { source: payload.source, enabled: payload.enabled, template: payload.template };
      useEditorStore.getState().setEntityScript(payload.entityId, script);
      return true;
    }

    case 'AUDIO_CHANGED': {
      const payload = data as unknown as {
        entityId: string;
        assetId?: string | null;
        volume?: number;
        pitch?: number;
        loopAudio?: boolean;
        spatial?: boolean;
        maxDistance?: number;
        refDistance?: number;
        rolloffFactor?: number;
        autoplay?: boolean;
        bus?: string;
      };
      const { entityId, ...audioData } = payload;
      // If assetId is defined (even if null), it means audio exists
      if (audioData.assetId !== undefined) {
        const audio = {
          assetId: audioData.assetId ?? null,
          volume: audioData.volume ?? 1.0,
          pitch: audioData.pitch ?? 1.0,
          loopAudio: audioData.loopAudio ?? false,
          spatial: audioData.spatial ?? false,
          maxDistance: audioData.maxDistance ?? 50,
          refDistance: audioData.refDistance ?? 1,
          rolloffFactor: audioData.rolloffFactor ?? 1,
          autoplay: audioData.autoplay ?? false,
          bus: audioData.bus ?? 'sfx',
        };
        useEditorStore.getState().setEntityAudio(entityId, audio);
      } else {
        useEditorStore.getState().setEntityAudio(entityId, null);
      }
      return true;
    }

    case 'REVERB_ZONE_CHANGED': {
      const payload = data as unknown as {
        entityId: string;
        enabled: boolean;
        shape: {
          type: 'box' | 'sphere';
          size?: [number, number, number];
          radius?: number;
        };
        preset: string;
        wetMix: number;
        decayTime: number;
        preDelay: number;
        blendRadius: number;
        priority: number;
      };
      const { entityId, enabled, shape, ...zoneData } = payload;
      const reverbShape: ReverbShape = shape.type === 'sphere'
        ? { type: 'sphere', radius: shape.radius ?? 5 }
        : { type: 'box', size: shape.size ?? [10, 5, 10] };
      const reverbZone: ReverbZoneData = {
        shape: reverbShape,
        preset: zoneData.preset,
        wetMix: zoneData.wetMix,
        decayTime: zoneData.decayTime,
        preDelay: zoneData.preDelay,
        blendRadius: zoneData.blendRadius,
        priority: zoneData.priority,
      };
      useEditorStore.getState().setReverbZone(entityId, reverbZone, enabled);
      return true;
    }

    case 'REVERB_ZONE_REMOVED': {
      const payload = data as unknown as { entityId: string };
      useEditorStore.getState().removeReverbZone(payload.entityId);
      return true;
    }

    case 'AUDIO_BUSES_CHANGED': {
      const payload = data as unknown as { buses: AudioBusDef[] };
      useEditorStore.getState().setAudioBuses(payload.buses);
      // Sync to Web Audio API
      import('@/lib/audio/audioManager').then(({ audioManager }) => {
        audioManager.applyBusConfig({ buses: payload.buses });
      });
      return true;
    }

    case 'AUDIO_PLAYBACK': {
      const payload = data as unknown as { entityId: string; action: 'play' | 'stop' | 'pause' | 'resume' };
      // Import audioManager and route playback
      import('@/lib/audio/audioManager').then(({ audioManager }) => {
        if (payload.action === 'play') audioManager.play(payload.entityId);
        else if (payload.action === 'stop') audioManager.stop(payload.entityId);
        else if (payload.action === 'pause') audioManager.pause(payload.entityId);
        else if (payload.action === 'resume') audioManager.resume(payload.entityId);
      });
      return true;
    }

    case 'INPUT_BINDINGS_CHANGED': {
      const payload = data as unknown as {
        actions: Record<string, {
          name: string;
          actionType: { type: string; positive?: { type: string; value: string }[]; negative?: { type: string; value: string }[] };
          sources: { type: string; value: string }[];
          deadZone: number;
        }>;
        preset: string | null;
      };
      // Convert Rust InputMap format to flat InputBinding array
      const bindings: InputBinding[] = Object.values(payload.actions).map((action) => {
        const isAxis = action.actionType.type === 'Axis';
        return {
          actionName: action.name,
          actionType: isAxis ? 'axis' as const : 'digital' as const,
          sources: action.sources.map((s) => s.value),
          positiveKeys: isAxis ? (action.actionType.positive ?? []).map((s) => s.value) : undefined,
          negativeKeys: isAxis ? (action.actionType.negative ?? []).map((s) => s.value) : undefined,
          deadZone: action.deadZone,
        };
      });
      const preset = payload.preset as InputPreset;
      useEditorStore.getState().setInputBindings(bindings, preset);
      return true;
    }

    case 'ASSET_IMPORTED': {
      const payload = data as unknown as { assetId: string; name: string; kind: string; fileSize: number };
      useEditorStore.getState().addAssetToRegistry({
        id: payload.assetId,
        name: payload.name,
        kind: payload.kind as 'gltf_model' | 'texture',
        fileSize: payload.fileSize,
        source: { type: 'upload', filename: payload.name },
      });
      return true;
    }

    case 'ASSET_DELETED': {
      const payload = data as unknown as { assetId: string };
      useEditorStore.getState().removeAssetFromRegistry(payload.assetId);
      return true;
    }

    case 'ASSET_LIST': {
      const payload = data as unknown as { assets: Record<string, AssetMetadata> };
      useEditorStore.getState().setAssetRegistry(payload.assets);
      return true;
    }

    default:
      return false;
  }
}
