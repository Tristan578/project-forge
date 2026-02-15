/**
 * Event handlers for materials, environment, post-processing, shaders, skybox.
 */

import { useEditorStore, type MaterialData, type EnvironmentData, type PostProcessingData } from '@/stores/editorStore';
import type { SetFn, GetFn } from './types';

export function handleMaterialEvent(
  type: string,
  data: Record<string, unknown>,
  _set: SetFn,
  _get: GetFn
): boolean {
  switch (type) {
    case 'MATERIAL_CHANGED': {
      const payload = data as unknown as MaterialData & { entityId: string };
      const { entityId: _matId, ...matData } = payload;
      useEditorStore.getState().setPrimaryMaterial(matData as MaterialData);
      return true;
    }

    case 'LIGHT_CHANGED': {
      const payload = data as unknown as import('@/stores/editorStore').LightData & { entityId: string };
      const { entityId: _lightId, ...lightData } = payload;
      useEditorStore.getState().setPrimaryLight(lightData as import('@/stores/editorStore').LightData);
      return true;
    }

    case 'AMBIENT_LIGHT_CHANGED': {
      const payload = data as unknown as import('@/stores/editorStore').AmbientLightData;
      useEditorStore.getState().setAmbientLight(payload);
      return true;
    }

    case 'ENVIRONMENT_CHANGED': {
      const payload = data as unknown as EnvironmentData;
      useEditorStore.getState().setEnvironment(payload);
      return true;
    }

    case 'POST_PROCESSING_CHANGED': {
      const payload = data as unknown as PostProcessingData;
      useEditorStore.getState().setPostProcessing(payload);
      return true;
    }

    case 'SHADER_CHANGED': {
      const payload = data as unknown as { entityId: string; data: import('@/stores/editorStore').ShaderEffectData | null };
      useEditorStore.getState().setPrimaryShaderEffect(payload.data || null);
      return true;
    }

    case 'CSG_COMPLETED': {
      const payload = data as unknown as { entityId: string; name: string; operation: string };
      console.log(`CSG ${payload.operation} completed: ${payload.name} (${payload.entityId})`);
      return true;
    }

    case 'CSG_ERROR': {
      const payload = data as unknown as { message: string };
      console.error(`CSG error: ${payload.message}`);
      return true;
    }

    case 'PROCEDURAL_MESH_CREATED': {
      const payload = data as unknown as { entityId: string; name: string; operation: string };
      console.log(`Procedural mesh ${payload.operation} completed: ${payload.name} (${payload.entityId})`);
      return true;
    }

    case 'PROCEDURAL_MESH_ERROR': {
      const payload = data as unknown as { message: string };
      console.error(`Procedural mesh error: ${payload.message}`);
      return true;
    }

    case 'ARRAY_COMPLETED': {
      const payload = data as unknown as { count: number };
      console.log(`Array completed: ${payload.count} entities created`);
      return true;
    }

    case 'TERRAIN_CHANGED': {
      const payload = data as unknown as { entityId: string; terrainData: import('@/stores/editorStore').TerrainDataState };
      useEditorStore.getState().setTerrainData(payload.entityId, payload.terrainData);
      return true;
    }

    case 'QUALITY_CHANGED': {
      const payload = data as unknown as {
        preset: string;
        msaaSamples: number;
        shadowsEnabled: boolean;
        shadowsDirectionalOnly: boolean;
        bloomEnabled: boolean;
        chromaticAberrationEnabled: boolean;
        sharpeningEnabled: boolean;
        particleDensityScale: number;
      };
      useEditorStore.getState().setQualityFromEngine(payload);
      return true;
    }

    case 'SKYBOX_UPDATED': {
      // Placeholder for skybox events (handled via environment_updated)
      return true;
    }

    default:
      return false;
  }
}
