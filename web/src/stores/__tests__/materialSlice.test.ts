/**
 * Unit tests for the materialSlice — material and shader effect state.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMaterialSlice, setMaterialDispatcher, type MaterialSlice } from '../slices/materialSlice';
import type { MaterialData, ShaderEffectData } from '../slices/types';

function createTestStore() {
  const store = { state: {} as MaterialSlice };
  const set = (partial: Partial<MaterialSlice> | ((s: MaterialSlice) => Partial<MaterialSlice>)) => {
    if (typeof partial === 'function') Object.assign(store.state, partial(store.state));
    else Object.assign(store.state, partial);
  };
  const get = () => store.state;
  store.state = createMaterialSlice(set as never, get as never, {} as never);
  return { getState: () => store.state };
}

const sampleMaterial: MaterialData = {
  baseColor: [1, 0, 0, 1],
  metallic: 0.5,
  perceptualRoughness: 0.3,
  reflectance: 0.5,
  emissive: [0, 0, 0, 1],
  emissiveExposureWeight: 0,
  alphaMode: 'opaque',
  alphaCutoff: 0.5,
  doubleSided: false,
  unlit: false,
  baseColorTexture: null,
  normalMapTexture: null,
  metallicRoughnessTexture: null,
  emissiveTexture: null,
  occlusionTexture: null,
};

describe('materialSlice', () => {
  let store: ReturnType<typeof createTestStore>;
  let mockDispatch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockDispatch = vi.fn();
    setMaterialDispatcher(mockDispatch as (command: string, payload: unknown) => void);
    store = createTestStore();
  });

  describe('Initial state', () => {
    it('should have null primary material', () => {
      expect(store.getState().primaryMaterial).toBeNull();
    });

    it('should have null primary shader effect', () => {
      expect(store.getState().primaryShaderEffect).toBeNull();
    });
  });

  describe('Material operations', () => {
    it('setPrimaryMaterial sets without dispatch', () => {
      store.getState().setPrimaryMaterial(sampleMaterial);
      expect(store.getState().primaryMaterial).toEqual(sampleMaterial);
      expect(mockDispatch).not.toHaveBeenCalled();
    });

    it('updateMaterial sets state and dispatches without texture fields', () => {
      store.getState().updateMaterial('ent-1', sampleMaterial);
      expect(store.getState().primaryMaterial).toEqual(sampleMaterial);
      expect(mockDispatch).toHaveBeenCalledTimes(1);
      const [cmd, payload] = mockDispatch.mock.calls[0];
      expect(cmd).toBe('update_material');
      expect(payload.entityId).toBe('ent-1');
      // Texture fields should be stripped
      expect(payload.baseColorTexture).toBeUndefined();
      expect(payload.normalMapTexture).toBeUndefined();
      expect(payload.metallicRoughnessTexture).toBeUndefined();
      expect(payload.emissiveTexture).toBeUndefined();
      expect(payload.occlusionTexture).toBeUndefined();
      // Non-texture fields preserved
      expect(payload.metallic).toBe(0.5);
      expect(payload.perceptualRoughness).toBe(0.3);
    });
  });

  describe('Shader effects', () => {
    const sampleShader: ShaderEffectData = {
      shaderType: 'dissolve',
      customColor: [1, 0, 0, 1],
      noiseScale: 5.0,
      emissionStrength: 1.0,
      dissolveThreshold: 0.5,
      dissolveEdgeWidth: 0.05,
      scanLineFrequency: 0,
      scanLineSpeed: 0,
      scrollSpeed: [0, 0],
      distortionStrength: 0,
      toonBands: 4,
      fresnelPower: 2.0,
    };

    it('setPrimaryShaderEffect sets without dispatch', () => {
      store.getState().setPrimaryShaderEffect(sampleShader);
      expect(store.getState().primaryShaderEffect).toEqual(sampleShader);
      expect(mockDispatch).not.toHaveBeenCalled();
    });

    it('setPrimaryShaderEffect accepts null', () => {
      store.getState().setPrimaryShaderEffect(sampleShader);
      store.getState().setPrimaryShaderEffect(null);
      expect(store.getState().primaryShaderEffect).toBeNull();
    });

    it('updateShaderEffect dispatches set_custom_shader', () => {
      store.getState().updateShaderEffect('ent-1', { shaderType: 'hologram', emissionStrength: 0.8 });
      expect(mockDispatch).toHaveBeenCalledWith('set_custom_shader', { entityId: 'ent-1', shaderType: 'hologram', emissionStrength: 0.8 });
    });

    it('removeShaderEffect dispatches remove_custom_shader', () => {
      store.getState().removeShaderEffect('ent-1');
      expect(mockDispatch).toHaveBeenCalledWith('remove_custom_shader', { entityId: 'ent-1' });
    });
  });

  describe('Dispatcher not set', () => {
    it('does not throw when dispatcher is null', () => {
      setMaterialDispatcher(null as never);
      store = createTestStore();
      expect(() => store.getState().updateMaterial('e', sampleMaterial)).not.toThrow();
      expect(() => store.getState().removeShaderEffect('e')).not.toThrow();
    });
  });
});
