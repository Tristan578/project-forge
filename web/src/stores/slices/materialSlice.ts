/**
 * Material slice - manages material and shader effect state.
 */

import { StateCreator } from 'zustand';
import type { CustomWgslSource, MaterialData, ShaderEffectData } from './types';

export interface MaterialSlice {
  // State
  primaryMaterial: MaterialData | null;
  primaryShaderEffect: ShaderEffectData | null;
  customWgslSource: CustomWgslSource | null;

  // Actions
  setPrimaryMaterial: (material: MaterialData) => void;
  updateMaterial: (entityId: string, material: MaterialData) => void;
  setPrimaryShaderEffect: (data: ShaderEffectData | null) => void;
  updateShaderEffect: (entityId: string, data: Partial<ShaderEffectData> & { shaderType: string }) => void;
  removeShaderEffect: (entityId: string) => void;
  setCustomWgslSource: (source: CustomWgslSource | null) => void;
  updateCustomWgslSource: (userCode: string, name: string) => void;
  validateWgsl: (code: string) => void;
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
  customWgslSource: null,

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
      dispatchCommand('set_custom_shader', { entityId, ...data });
    }
  },

  removeShaderEffect: (entityId) => {
    if (dispatchCommand) {
      dispatchCommand('remove_custom_shader', { entityId });
    }
  },

  setCustomWgslSource: (source) => set({ customWgslSource: source }),

  updateCustomWgslSource: (userCode, name) => {
    // Optimistically set pending status.
    set((state) => ({
      customWgslSource: state.customWgslSource
        ? { ...state.customWgslSource, userCode, name, compileStatus: 'pending', compileError: null }
        : { userCode, name, compileStatus: 'pending', compileError: null },
    }));
    if (dispatchCommand) {
      dispatchCommand('set_custom_wgsl_source', { userCode, name });
    }
  },

  validateWgsl: (code) => {
    if (dispatchCommand) {
      dispatchCommand('validate_wgsl', { code });
    }
  },
});
