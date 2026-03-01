import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createSliceStore, createMockDispatch } from './sliceTestTemplate';
import { createLightingSlice, setLightingDispatcher, type LightingSlice } from '../lightingSlice';

describe('lightingSlice', () => {
  let store: ReturnType<typeof createSliceStore<LightingSlice>>;
  let mockDispatch: ReturnType<typeof createMockDispatch>;

  beforeEach(() => {
    mockDispatch = createMockDispatch();
    setLightingDispatcher(mockDispatch);
    store = createSliceStore(createLightingSlice);
  });

  afterEach(() => {
    setLightingDispatcher(null as unknown as (command: string, payload: unknown) => void);
  });

  describe('Initial state', () => {
    it('should have default ambient light and environment', () => {
      expect(store.getState().primaryLight).toBeNull();
      expect(store.getState().ambientLight).toEqual({ color: [1, 1, 1], brightness: 300 });
      expect(store.getState().environment.skyboxBrightness).toBe(1000);
      expect(store.getState().environment.fogEnabled).toBe(false);
      expect(store.getState().environment.skyboxPreset).toBeNull();
    });
  });

  describe('setPrimaryLight / updateLight', () => {
    it('should set primary light', () => {
      const light = { type: 'point', color: [1, 0, 0], intensity: 500 };
      store.getState().setPrimaryLight(light as never);
      expect(store.getState().primaryLight).toEqual(light);
    });

    it('updateLight should set primary and dispatch', () => {
      const light = { type: 'spot', color: [0, 1, 0], intensity: 200 };
      store.getState().updateLight('light-1', light as never);

      expect(store.getState().primaryLight).toEqual(light);
      expect(mockDispatch).toHaveBeenCalledWith('update_light', { entityId: 'light-1', ...light });
    });
  });

  describe('setAmbientLight / updateAmbientLight', () => {
    it('should replace ambient light', () => {
      const data = { color: [0.5, 0.5, 0.5], brightness: 100 };
      store.getState().setAmbientLight(data as never);
      expect(store.getState().ambientLight).toEqual(data);
    });

    it('updateAmbientLight should merge and dispatch', () => {
      store.getState().updateAmbientLight({ brightness: 500 });

      expect(store.getState().ambientLight.brightness).toBe(500);
      expect(store.getState().ambientLight.color).toEqual([1, 1, 1]); // unchanged
      expect(mockDispatch).toHaveBeenCalledWith('update_ambient_light', { brightness: 500 });
    });
  });

  describe('setEnvironment / updateEnvironment', () => {
    it('should replace environment', () => {
      const env = {
        skyboxBrightness: 500,
        iblIntensity: 400,
        iblRotationDegrees: 90,
        clearColor: [0, 0, 0],
        fogEnabled: true,
        fogColor: [1, 1, 1],
        fogStart: 10,
        fogEnd: 50,
        skyboxPreset: 'sunset',
        skyboxAssetId: null,
      };
      store.getState().setEnvironment(env as never);
      expect(store.getState().environment.skyboxBrightness).toBe(500);
      expect(store.getState().environment.fogEnabled).toBe(true);
    });

    it('updateEnvironment should merge and dispatch', () => {
      store.getState().updateEnvironment({ fogEnabled: true, fogStart: 5 });

      expect(store.getState().environment.fogEnabled).toBe(true);
      expect(store.getState().environment.fogStart).toBe(5);
      expect(store.getState().environment.skyboxBrightness).toBe(1000); // unchanged
      expect(mockDispatch).toHaveBeenCalledWith('update_environment', { fogEnabled: true, fogStart: 5 });
    });
  });

  describe('skybox commands', () => {
    it('setSkybox should dispatch set_skybox', () => {
      store.getState().setSkybox('sunset');
      expect(mockDispatch).toHaveBeenCalledWith('set_skybox', { preset: 'sunset' });
    });

    it('setCustomSkybox should dispatch with asset data', () => {
      store.getState().setCustomSkybox('asset-1', 'base64data');
      expect(mockDispatch).toHaveBeenCalledWith('set_custom_skybox', {
        assetId: 'asset-1',
        dataBase64: 'base64data',
      });
    });

    it('removeSkybox should dispatch remove_skybox', () => {
      store.getState().removeSkybox();
      expect(mockDispatch).toHaveBeenCalledWith('remove_skybox', {});
    });

    it('updateSkybox should dispatch with changes', () => {
      store.getState().updateSkybox({ brightness: 800, rotation: 45 });
      expect(mockDispatch).toHaveBeenCalledWith('update_skybox', { brightness: 800, rotation: 45 });
    });
  });
});
