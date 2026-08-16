/**
 * Event handlers for scripts, audio, audio buses, reverb zones.
 */

import { useEditorStore, type ScriptData, type AudioData, type AudioBusDef, type ReverbZoneData, type ReverbShape, type InputBinding, type InputPreset, type AssetMetadata } from '@/stores/editorStore';
import { forgetImportedAudioAsset, ingestImportedAudioAsset, syncEntityAudioInstance } from '@/lib/audio/entityAudioGraph';
import { castPayload, type SetFn, type GetFn } from './types';

export function handleAudioEvent(
  type: string,
  data: Record<string, unknown>,
  _set: SetFn,
  _get: GetFn
): boolean {
  switch (type) {
    // Both arms below read the component NESTED under its own key, because that
    // is what the engine emits: `ScriptPayload { entity_id, script }` and
    // `AudioPayload { entity_id, audio }` in `engine/src/bridge/events.rs`,
    // neither carrying `#[serde(flatten)]`. Reading these fields flat off the
    // payload — as both arms used to — is the mirror image of the documented
    // `dispatchCommand` wire-shape class: every field resolves to `undefined`,
    // nothing throws, and the store quietly records an empty component. The
    // sibling `emit_material_changed` DOES flatten, which is exactly why the
    // shape has to be read from the emitter rather than assumed.
    case 'SCRIPT_CHANGED': {
      const payload = castPayload<{
        entityId: string;
        script?: { source?: string; enabled?: boolean; template?: string | null } | null;
      }>(data);
      const source = payload.script;
      const script: ScriptData | null = source
        ? {
          source: source.source ?? '',
          enabled: source.enabled ?? false,
          template: source.template ?? null,
        }
        : null;
      useEditorStore.getState().setEntityScript(payload.entityId, script);
      return true;
    }

    case 'AUDIO_CHANGED': {
      const payload = castPayload<{
        entityId: string;
        audio?: {
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
        } | null;
      }>(data);
      const { entityId } = payload;
      // Absent or null means the entity has no audio component at all — the
      // engine omits the key rather than sending an empty object.
      const source = payload.audio;
      const audio: AudioData | null = source
        ? {
          assetId: source.assetId ?? null,
          volume: source.volume ?? 1.0,
          pitch: source.pitch ?? 1.0,
          loopAudio: source.loopAudio ?? false,
          spatial: source.spatial ?? false,
          maxDistance: source.maxDistance ?? 50,
          refDistance: source.refDistance ?? 1,
          rolloffFactor: source.rolloffFactor ?? 1,
          autoplay: source.autoplay ?? false,
          bus: source.bus ?? 'sfx',
        }
        : null;
      useEditorStore.getState().setEntityAudio(entityId, audio);
      // The engine emits this for whichever entity changed, so the graph is
      // rebuilt for that entity — not for whatever happens to be selected.
      syncEntityAudioInstance(entityId, audio);
      return true;
    }

    case 'REVERB_ZONE_CHANGED': {
      const payload = castPayload<{
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
      }>(data);
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
      const payload = castPayload<{ entityId: string }>(data);
      useEditorStore.getState().removeReverbZone(payload.entityId);
      return true;
    }

    case 'AUDIO_BUSES_CHANGED': {
      const payload = castPayload<{ buses: AudioBusDef[] }>(data);
      useEditorStore.getState().setAudioBuses(payload.buses);
      // Sync to Web Audio API
      import('@/lib/audio/audioManager').then(({ audioManager }) => {
        audioManager.applyBusConfig({ buses: payload.buses });
      });
      return true;
    }

    case 'AUDIO_PLAYBACK': {
      const payload = castPayload<{ entityId: string; action: 'play' | 'stop' | 'pause' | 'resume' }>(data);
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
      const payload = castPayload<{
        actions: Record<string, {
          name: string;
          actionType: { type: string; positive?: { type: string; value: string }[]; negative?: { type: string; value: string }[] };
          sources: { type: string; value: string }[];
          deadZone: number;
        }>;
        preset: string | null;
      }>(data);
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
      const payload = castPayload<{ assetId: string; name: string; kind: string; fileSize: number }>(data);
      useEditorStore.getState().addAssetToRegistry({
        id: payload.assetId,
        name: payload.name,
        kind: payload.kind as AssetMetadata['kind'],
        fileSize: payload.fileSize,
        source: { type: 'upload', filename: payload.name },
      });
      if (payload.kind === 'audio') {
        // This is the first moment JS learns the asset id the engine minted, and
        // the only correlation back to the bytes it dropped is `name`.
        void ingestImportedAudioAsset(
          payload.assetId,
          payload.name,
          () => useEditorStore.getState().entityAudio
        );
      }
      return true;
    }

    case 'ASSET_DELETED': {
      const payload = castPayload<{ assetId: string }>(data);
      useEditorStore.getState().removeAssetFromRegistry(payload.assetId);
      // A name alias outliving its asset would resolve to an id with no decoded
      // buffer, which reads as a permanently silent entity rather than an error.
      forgetImportedAudioAsset(payload.assetId);
      return true;
    }

    case 'ASSET_LIST': {
      const payload = castPayload<{ assets: Record<string, AssetMetadata> }>(data);
      useEditorStore.getState().setAssetRegistry(payload.assets);
      return true;
    }

    default:
      return false;
  }
}
