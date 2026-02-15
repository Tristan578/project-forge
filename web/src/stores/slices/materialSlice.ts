/**
 * Material slice - manages material and shader effect state.
 * TODO: Extract full implementation from editorStore.ts
 */

import { StateCreator } from 'zustand';
import type { MaterialData, ShaderEffectData } from './types';

export interface MaterialSlice {
  // State
  primaryMaterial: MaterialData | null;
  primaryShaderEffect: ShaderEffectData | null;

  // Actions
  setPrimaryMaterial: (material: MaterialData) => void;
  updateMaterial: (entityId: string, material: MaterialData) => void;
  setPrimaryShaderEffect: (data: ShaderEffectData | null) => void;
  updateShaderEffect: (entityId: string, data: Partial<ShaderEffectData> & { shaderType: string }) => void;
  removeShaderEffect: (entityId: string) => void;
}

let dispatchCommand: ((command: string, payload: unknown) => void) | null = null;

export function setMaterialDispatcher(dispatcher: (command: string, payload: unknown) => void): void {
  dispatchCommand = dispatcher;
}

export const createMaterialSlice: StateCreator<
  MaterialSlice,
  [],
  [],
  MaterialSlice
> = (set) => ({
  primaryMaterial: null,
  primaryShaderEffect: null,

  setPrimaryMaterial: (material) => set({ primaryMaterial: material }),

  updateMaterial: (entityId, material) => {
    set({ primaryMaterial: material });
    if (dispatchCommand) {
      // Filter out texture fields (managed separately via load_texture)
      const { baseColorTexture: _bct, normalMapTexture: _nmt, metallicRoughnessTexture: _mrt,
              emissiveTexture: _et, occlusionTexture: _ot,
              depthMapTexture: _dmt, clearcoatTexture: _ct, clearcoatRoughnessTexture: _crt,
              clearcoatNormalTexture: _cnt, ...materialFields } = material;
      dispatchCommand('update_material', {
        entityId,
        ...materialFields,
      });
    }
  },

  setPrimaryShaderEffect: (data) => set({ primaryShaderEffect: data }),

  updateShaderEffect: (entityId, data) => {
    if (dispatchCommand) {
      dispatchCommand('update_shader_effect', { entityId, ...data });
    }
  },

  removeShaderEffect: (entityId) => {
    if (dispatchCommand) {
      dispatchCommand('remove_shader_effect', { entityId });
    }
  },
});
