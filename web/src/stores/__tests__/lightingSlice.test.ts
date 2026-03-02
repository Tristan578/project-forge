/**
 * Unit tests for the lightingSlice — lights, ambient, environment, skybox.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createLightingSlice, setLightingDispatcher, type LightingSlice } from '../slices/lightingSlice';

function createTestStore() {
  const store = { state: {} as LightingSlice };
  const set = (partial: Partial<LightingSlice> | ((s: LightingSlice) => Partial<LightingSlice>)) => {
    if (typeof partial === 'function') Object.assign(store.state, partial(store.state));
    else Object.assign(store.state, partial);
  };
  const get = () => store.state;
  store.state = createLightingSlice(set as never, get as never, {} as never);
  return { getState: () => store.state };
}

describe('lightingSlice', () => {
  let store: ReturnType<typeof createTestStore>;
  let mockDispatch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockDispatch = vi.fn();
    setLightingDispatcher(mockDispatch as (command: string, payload: unknown) => void);
    store = createTestStore();
  });

  describe('Initial state', () => {
    it('should have null primary light', () => {
      expect(store.getState().primaryLight).toBeNull();
    });

    it('should have default ambient light', () => {
      expect(store.getState().ambientLight).toEqual({ color: [1, 1, 1], brightness: 300 });
    });

    it('should have default environment with no skybox', () => {
      const env = store.getState().environment;
      expect(env.skyboxPreset).toBeNull();
      expect(env.skyboxAssetId).toBeNull();
      expect(env.fogEnabled).toBe(false);
    });
  });

  describe('Light CRUD', () => {
    const sampleLight = {
      lightType: 'point' as const,
      color: [1, 0.9, 0.8] as [number, number, number],
      intensity: 1000,
      shadowsEnabled: true,
      shadowDepthBias: 0.02,
      shadowNormalBias: 1.8,
      range: 20,
      radius: 0,
      innerAngle: 0,
      outerAngle: 0.7,
    };

    it('setPrimaryLight sets light without dispatch', () => {
      store.getState().setPrimaryLight(sampleLight);
      expect(store.getState().primaryLight).toEqual(sampleLight);
      expect(mockDispatch).not.toHaveBeenCalled();
    });

    it('updateLight sets state and dispatches', () => {
      store.getState().updateLight('ent-1', sampleLight);
      expect(store.getState().primaryLight).toEqual(sampleLight);
      expect(mockDispatch).toHaveBeenCalledWith('update_light', { entityId: 'ent-1', ...sampleLight });
    });
  });

  describe('Ambient light', () => {
    it('setAmbientLight replaces without dispatch', () => {
      const ambient = { color: [0.5, 0.5, 0.6] as [number, number, number], brightness: 500 };
      store.getState().setAmbientLight(ambient);
      expect(store.getState().ambientLight).toEqual(ambient);
      expect(mockDispatch).not.toHaveBeenCalled();
    });

    it('updateAmbientLight merges and dispatches', () => {
      store.getState().updateAmbientLight({ brightness: 600 });
      expect(store.getState().ambientLight.brightness).toBe(600);
      expect(store.getState().ambientLight.color).toEqual([1, 1, 1]); // unchanged
      expect(mockDispatch).toHaveBeenCalledWith('update_ambient_light', { brightness: 600 });
    });
  });

  describe('Environment', () => {
    it('setEnvironment replaces without dispatch', () => {
      const env = { ...store.getState().environment, fogEnabled: true };
      store.getState().setEnvironment(env);
      expect(store.getState().environment.fogEnabled).toBe(true);
      expect(mockDispatch).not.toHaveBeenCalled();
    });

    it('updateEnvironment merges and dispatches', () => {
      store.getState().updateEnvironment({ fogEnabled: true, fogStart: 10 });
      expect(store.getState().environment.fogEnabled).toBe(true);
      expect(store.getState().environment.fogStart).toBe(10);
      expect(store.getState().environment.fogEnd).toBe(100); // unchanged
      expect(mockDispatch).toHaveBeenCalledWith('update_environment', { fogEnabled: true, fogStart: 10 });
    });
  });

  describe('Skybox', () => {
    it('setSkybox dispatches preset', () => {
      store.getState().setSkybox('sunset');
      expect(mockDispatch).toHaveBeenCalledWith('set_skybox', { preset: 'sunset' });
    });

    it('setCustomSkybox dispatches asset ID and base64', () => {
      store.getState().setCustomSkybox('sky-001', 'base64data...');
      expect(mockDispatch).toHaveBeenCalledWith('set_custom_skybox', { assetId: 'sky-001', dataBase64: 'base64data...' });
    });

    it('removeSkybox dispatches', () => {
      store.getState().removeSkybox();
      expect(mockDispatch).toHaveBeenCalledWith('remove_skybox', {});
    });

    it('updateSkybox dispatches partial changes', () => {
      store.getState().updateSkybox({ brightness: 1500, rotation: 45 });
      expect(mockDispatch).toHaveBeenCalledWith('update_skybox', { brightness: 1500, rotation: 45 });
    });
  });

  describe('Dispatcher not set', () => {
    it('does not throw when dispatcher is null', () => {
      setLightingDispatcher(null as never);
      store = createTestStore();
      expect(() => store.getState().updateLight('e', {} as never)).not.toThrow();
      expect(() => store.getState().setSkybox('test')).not.toThrow();
    });
  });
});
