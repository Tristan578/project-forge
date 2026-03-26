/**
 * Event handlers for materials, environment, post-processing, shaders, skybox.
 */

import { useEditorStore, type MaterialData, type EnvironmentData, type PostProcessingData } from '@/stores/editorStore';
import { castPayload, type SetFn, type GetFn } from './types';

export function handleMaterialEvent(
  type: string,
  data: Record<string, unknown>,
  _set: SetFn,
  _get: GetFn
): boolean {
  switch (type) {
    case 'MATERIAL_CHANGED': {
      const payload = castPayload<MaterialData & { entityId: string }>(data);
      const { entityId: _matId, ...matData } = payload;
      useEditorStore.getState().setPrimaryMaterial(matData as MaterialData);
      return true;
    }

    case 'LIGHT_CHANGED': {
      const payload = castPayload<import('@/stores/editorStore').LightData & { entityId: string }>(data);
      const { entityId: _lightId, ...lightData } = payload;
      useEditorStore.getState().setPrimaryLight(lightData as import('@/stores/editorStore').LightData);
      return true;
    }

    case 'AMBIENT_LIGHT_CHANGED': {
      const payload = castPayload<import('@/stores/editorStore').AmbientLightData>(data);
      useEditorStore.getState().setAmbientLight(payload);
      useEditorStore.getState().setSceneLightAmbient(payload.color, payload.brightness);
      return true;
    }

    case 'ENVIRONMENT_CHANGED': {
      const payload = castPayload<EnvironmentData>(data);
      useEditorStore.getState().setEnvironment(payload);
      return true;
    }

    case 'POST_PROCESSING_CHANGED': {
      const payload = castPayload<PostProcessingData>(data);
      useEditorStore.getState().setPostProcessing(payload);
      return true;
    }

    case 'SHADER_CHANGED': {
      const payload = castPayload<{ entityId: string; data: import('@/stores/editorStore').ShaderEffectData | null }>(data);
      useEditorStore.getState().setPrimaryShaderEffect(payload.data || null);
      return true;
    }

    case 'CSG_COMPLETED': {
      const payload = castPayload<{ entityId: string; name: string; operation: string }>(data);
      console.log(`CSG ${payload.operation} completed: ${payload.name} (${payload.entityId})`);
      return true;
    }

    case 'CSG_ERROR': {
      const payload = castPayload<{ message: string }>(data);
      console.error(`CSG error: ${payload.message}`);
      return true;
    }

    case 'PROCEDURAL_MESH_CREATED': {
      const payload = castPayload<{ entityId: string; name: string; operation: string }>(data);
      console.log(`Procedural mesh ${payload.operation} completed: ${payload.name} (${payload.entityId})`);
      return true;
    }

    case 'PROCEDURAL_MESH_ERROR': {
      const payload = castPayload<{ message: string }>(data);
      console.error(`Procedural mesh error: ${payload.message}`);
      return true;
    }

    case 'ARRAY_COMPLETED': {
      const payload = castPayload<{ count: number }>(data);
      console.log(`Array completed: ${payload.count} entities created`);
      return true;
    }

    case 'TERRAIN_CHANGED': {
      const payload = castPayload<{ entityId: string; terrainData: import('@/stores/editorStore').TerrainDataState }>(data);
      useEditorStore.getState().setTerrainData(payload.entityId, payload.terrainData);
      return true;
    }

    case 'QUALITY_CHANGED': {
      const payload = castPayload<{
        preset: string;
        msaaSamples: number;
        shadowsEnabled: boolean;
        shadowsDirectionalOnly: boolean;
        bloomEnabled: boolean;
        chromaticAberrationEnabled: boolean;
        sharpeningEnabled: boolean;
        particleDensityScale: number;
      }>(data);
      useEditorStore.getState().setQualityFromEngine(payload);
      return true;
    }

    case 'SKYBOX_UPDATED': {
      // Placeholder for skybox events (handled via environment_updated)
      return true;
    }

    case 'CUSTOM_WGSL_SOURCE_CHANGED': {
      const payload = castPayload<import('@/stores/slices/types').CustomWgslSource>(data);
      useEditorStore.getState().setCustomWgslSource(payload);
      return true;
    }

    default:
      return false;
  }
}
