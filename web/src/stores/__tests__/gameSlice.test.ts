/**
 * Unit tests for the gameSlice — game components, cameras, mobile controls, mode.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createGameSlice, setGameDispatcher, type GameSlice } from '../slices/gameSlice';

function createTestStore() {
  let state: GameSlice;
  const set = (partial: Partial<GameSlice> | ((s: GameSlice) => Partial<GameSlice>)) => {
    if (typeof partial === 'function') Object.assign(state, partial(state));
    else Object.assign(state, partial);
  };
  const get = () => state;
  state = createGameSlice(set as never, get as never, {} as never);
  return { getState: () => state };
}

describe('gameSlice', () => {
  let store: ReturnType<typeof createTestStore>;
  let mockDispatch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockDispatch = vi.fn();
    setGameDispatcher(mockDispatch);
    store = createTestStore();
  });

  describe('Initial state', () => {
    it('should have empty game components', () => {
      expect(store.getState().allGameComponents).toEqual({});
      expect(store.getState().primaryGameComponents).toBeNull();
    });

    it('should have no active camera', () => {
      expect(store.getState().allGameCameras).toEqual({});
      expect(store.getState().activeGameCameraId).toBeNull();
      expect(store.getState().primaryGameCamera).toBeNull();
    });

    it('should start in edit mode', () => {
      expect(store.getState().engineMode).toBe('edit');
    });

    it('should have default mobile touch config', () => {
      expect(store.getState().mobileTouchConfig.enabled).toBe(true);
      expect(store.getState().mobileTouchConfig.preset).toBe('platformer');
    });

    it('should have empty HUD elements', () => {
      expect(store.getState().hudElements).toEqual([]);
    });
  });

  describe('Game components', () => {
    const healthComponent = {
      type: 'health',
      maxHealth: 100,
      currentHealth: 100,
      regeneration: 0,
    };

    const collectibleComponent = {
      type: 'collectible',
      value: 10,
      effect: 'score',
    };

    it('addGameComponent adds to entity array', () => {
      store.getState().addGameComponent('ent-1', healthComponent);
      expect(store.getState().allGameComponents['ent-1']).toHaveLength(1);
      expect(store.getState().allGameComponents['ent-1'][0]).toEqual(healthComponent);
      expect(mockDispatch).toHaveBeenCalledWith('add_game_component', {
        entityId: 'ent-1', component: healthComponent,
      });
    });

    it('addGameComponent appends to existing array', () => {
      store.getState().addGameComponent('ent-1', healthComponent);
      store.getState().addGameComponent('ent-1', collectibleComponent);
      expect(store.getState().allGameComponents['ent-1']).toHaveLength(2);
    });

    it('updateGameComponent replaces matching type', () => {
      store.getState().addGameComponent('ent-1', healthComponent);
      const updated = { ...healthComponent, currentHealth: 50 };
      store.getState().updateGameComponent('ent-1', updated);
      expect(store.getState().allGameComponents['ent-1'][0].currentHealth).toBe(50);
    });

    it('removeGameComponent filters by type', () => {
      store.getState().addGameComponent('ent-1', healthComponent);
      store.getState().addGameComponent('ent-1', collectibleComponent);
      store.getState().removeGameComponent('ent-1', 'health');
      expect(store.getState().allGameComponents['ent-1']).toHaveLength(1);
      expect(store.getState().allGameComponents['ent-1'][0].type).toBe('collectible');
    });
  });

  describe('Game cameras', () => {
    const cameraData = {
      mode: 'thirdPerson' as const,
      followDistance: 5,
      followHeight: 2,
      followSmoothness: 0.1,
    };

    it('setGameCamera stores and dispatches', () => {
      store.getState().setGameCamera('cam-1', cameraData);
      expect(store.getState().allGameCameras['cam-1']).toEqual(cameraData);
      expect(mockDispatch).toHaveBeenCalledWith('set_game_camera', { entityId: 'cam-1', ...cameraData });
    });

    it('removeGameCamera removes from map', () => {
      store.getState().setGameCamera('cam-1', cameraData);
      store.getState().removeGameCamera('cam-1');
      expect(store.getState().allGameCameras['cam-1']).toBeUndefined();
    });

    it('setActiveGameCamera dispatches and sets ID', () => {
      store.getState().setActiveGameCamera('cam-1');
      expect(store.getState().activeGameCameraId).toBe('cam-1');
      expect(mockDispatch).toHaveBeenCalledWith('set_active_game_camera', { entityId: 'cam-1' });
    });

    it('cameraShake dispatches intensity and duration', () => {
      store.getState().cameraShake('cam-1', 0.5, 500);
      expect(mockDispatch).toHaveBeenCalledWith('camera_shake', {
        entityId: 'cam-1', intensity: 0.5, duration: 500,
      });
    });

    it('setEntityGameCamera updates primary without dispatch', () => {
      store.getState().setEntityGameCamera('cam-1', cameraData);
      expect(store.getState().primaryGameCamera).toEqual(cameraData);
      expect(mockDispatch).not.toHaveBeenCalled();
    });
  });

  describe('Mobile touch config', () => {
    it('setMobileTouchConfig replaces entire config', () => {
      const newConfig = { ...store.getState().mobileTouchConfig, enabled: false, preset: 'shooter' as const };
      store.getState().setMobileTouchConfig(newConfig);
      expect(store.getState().mobileTouchConfig.enabled).toBe(false);
      expect(store.getState().mobileTouchConfig.preset).toBe('shooter');
    });

    it('updateMobileTouchConfig merges partial', () => {
      store.getState().updateMobileTouchConfig({ enabled: false });
      expect(store.getState().mobileTouchConfig.enabled).toBe(false);
      expect(store.getState().mobileTouchConfig.preset).toBe('platformer'); // unchanged
    });
  });

  describe('Engine mode', () => {
    it('play dispatches play command', () => {
      store.getState().play();
      expect(mockDispatch).toHaveBeenCalledWith('play', {});
    });

    it('stop dispatches stop command', () => {
      store.getState().stop();
      expect(mockDispatch).toHaveBeenCalledWith('stop', {});
    });

    it('pause dispatches pause command', () => {
      store.getState().pause();
      expect(mockDispatch).toHaveBeenCalledWith('pause', {});
    });

    it('resume dispatches resume command', () => {
      store.getState().resume();
      expect(mockDispatch).toHaveBeenCalledWith('resume', {});
    });

    it('setEngineMode changes mode without dispatch', () => {
      store.getState().setEngineMode('play');
      expect(store.getState().engineMode).toBe('play');
      expect(mockDispatch).not.toHaveBeenCalled();
    });
  });

  describe('HUD and loading screen', () => {
    it('setHudElements replaces array', () => {
      const elements = [{ id: 'score', text: 'Score: 0', x: 10, y: 10, visible: true }];
      store.getState().setHudElements(elements);
      expect(store.getState().hudElements).toEqual(elements);
    });

    it('setLoadingScreenConfig stores config', () => {
      const config = { type: 'progress-bar' as const, backgroundColor: '#000', progressColor: '#fff', logoUrl: null, tipTexts: [] };
      store.getState().setLoadingScreenConfig(config);
      expect(store.getState().loadingScreenConfig).toEqual(config);
    });
  });
});
