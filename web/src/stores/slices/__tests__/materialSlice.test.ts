import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createSliceStore, createMockDispatch } from './sliceTestTemplate';
import { createMaterialSlice, setMaterialDispatcher, type MaterialSlice } from '../materialSlice';

describe('materialSlice', () => {
  let store: ReturnType<typeof createSliceStore<MaterialSlice>>;
  let mockDispatch: ReturnType<typeof createMockDispatch>;

  beforeEach(() => {
    mockDispatch = createMockDispatch();
    setMaterialDispatcher(mockDispatch);
    store = createSliceStore(createMaterialSlice);
  });

  afterEach(() => {
    setMaterialDispatcher(null as unknown as (command: string, payload: unknown) => void);
  });

  describe('Initial state', () => {
    it('should start with null material and shader effect', () => {
      expect(store.getState().primaryMaterial).toBeNull();
      expect(store.getState().primaryShaderEffect).toBeNull();
    });
  });

  describe('setPrimaryMaterial', () => {
    it('should set primary material', () => {
      const mat = { baseColor: [1, 0, 0, 1], metallic: 0.5 };
      store.getState().setPrimaryMaterial(mat as never);
      expect(store.getState().primaryMaterial).toEqual(mat);
    });
  });

  describe('updateMaterial', () => {
    it('should set primary material and dispatch', () => {
      const mat = { baseColor: [0, 1, 0, 1], roughness: 0.3, metallic: 0.8 };
      store.getState().updateMaterial('ent-1', mat as never);

      expect(store.getState().primaryMaterial).toEqual(mat);
      expect(mockDispatch).toHaveBeenCalledWith('update_material', expect.objectContaining({
        entityId: 'ent-1',
        baseColor: [0, 1, 0, 1],
      }));
    });

    it('should strip texture fields from dispatch', () => {
      const mat = {
        baseColor: [1, 1, 1, 1],
        metallic: 0.5,
        baseColorTexture: 'tex-1',
        normalMapTexture: 'tex-2',
        metallicRoughnessTexture: 'tex-3',
        emissiveTexture: 'tex-4',
        occlusionTexture: 'tex-5',
        depthMapTexture: 'tex-6',
        clearcoatTexture: 'tex-7',
        clearcoatRoughnessTexture: 'tex-8',
        clearcoatNormalTexture: 'tex-9',
      };
      store.getState().updateMaterial('ent-1', mat as never);

      const call = mockDispatch.mock.calls[0][1] as Record<string, unknown>;
      expect(call.baseColorTexture).toBeUndefined();
      expect(call.normalMapTexture).toBeUndefined();
      expect(call.metallicRoughnessTexture).toBeUndefined();
      expect(call.emissiveTexture).toBeUndefined();
      expect(call.occlusionTexture).toBeUndefined();
      expect(call.depthMapTexture).toBeUndefined();
      expect(call.clearcoatTexture).toBeUndefined();
      expect(call.clearcoatRoughnessTexture).toBeUndefined();
      expect(call.clearcoatNormalTexture).toBeUndefined();
      // Non-texture fields should still be there
      expect(call.baseColor).toEqual([1, 1, 1, 1]);
      expect(call.metallic).toBe(0.5);
    });
  });

  describe('setPrimaryShaderEffect', () => {
    it('should set shader effect', () => {
      const effect = { shaderType: 'toon', outlineWidth: 2.0 };
      store.getState().setPrimaryShaderEffect(effect as never);
      expect(store.getState().primaryShaderEffect).toEqual(effect);
    });

    it('should clear shader effect with null', () => {
      store.getState().setPrimaryShaderEffect({ shaderType: 'toon' } as never);
      store.getState().setPrimaryShaderEffect(null);
      expect(store.getState().primaryShaderEffect).toBeNull();
    });
  });

  describe('updateShaderEffect', () => {
    it('should dispatch set_custom_shader', () => {
      store.getState().updateShaderEffect('ent-1', { shaderType: 'hologram' } as Partial<import('../types').ShaderEffectData> & { shaderType: string });

      expect(mockDispatch).toHaveBeenCalledWith('set_custom_shader', expect.objectContaining({
        entityId: 'ent-1',
        shaderType: 'hologram',
      }));
    });
  });

  describe('removeShaderEffect', () => {
    it('should dispatch remove_custom_shader', () => {
      store.getState().removeShaderEffect('ent-1');
      expect(mockDispatch).toHaveBeenCalledWith('remove_custom_shader', { entityId: 'ent-1' });
    });
  });
});
