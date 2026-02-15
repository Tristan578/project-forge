import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createSliceStore, createMockDispatch } from './sliceTestTemplate';
import { createGameSlice, setGameDispatcher, type GameSlice } from '../gameSlice';
import type { GameComponentData, GameCameraData, MobileTouchConfig, HudElement } from '../types';

describe('gameSlice', () => {
  let store: ReturnType<typeof createSliceStore<GameSlice>>;
  let mockDispatch: ReturnType<typeof createMockDispatch>;

  beforeEach(() => {
    mockDispatch = createMockDispatch();
    setGameDispatcher(mockDispatch);
    store = createSliceStore(createGameSlice);
  });

  afterEach(() => {
    setGameDispatcher(null as unknown as (command: string, payload: unknown) => void);
  });

  describe('Initial State', () => {
    it('should have empty game components', () => {
      const state = store.getState();
      expect(state.allGameComponents).toEqual({});
      expect(state.primaryGameComponents).toBeNull();
    });

    it('should have empty game cameras', () => {
      const state = store.getState();
      expect(state.allGameCameras).toEqual({});
      expect(state.activeGameCameraId).toBeNull();
      expect(state.primaryGameCamera).toBeNull();
    });

    it('should have default mobile touch config', () => {
      const state = store.getState();
      expect(state.mobileTouchConfig).toEqual({
        enabled: true,
        autoDetect: true,
        preset: 'platformer',
        joystick: {
          position: 'bottom-left',
          size: 120,
          deadZone: 0.15,
          opacity: 0.6,
          mode: 'floating',
          actions: { horizontal: 'move_right', vertical: 'move_forward' },
        },
        buttons: [{ id: 'jump', action: 'jump', position: { x: 85, y: 75 }, size: 80, icon: '↑', opacity: 0.6 }],
        preferredOrientation: 'any',
        autoReduceQuality: true,
      });
    });

    it('should have empty HUD elements', () => {
      const state = store.getState();
      expect(state.hudElements).toEqual([]);
    });

    it('should have edit engine mode', () => {
      const state = store.getState();
      expect(state.engineMode).toBe('edit');
    });
  });

  describe('Game Components', () => {
    const characterController: GameComponentData = {
      type: 'characterController',
      characterController: {
        speed: 5.0,
        jumpHeight: 2.0,
        gravityScale: 1.0,
        canDoubleJump: false,
      },
    };

    const health: GameComponentData = {
      type: 'health',
      health: {
        maxHp: 100,
        currentHp: 100,
        invincibilitySecs: 0,
        respawnOnDeath: false,
        respawnPoint: [0, 0, 0],
      },
    };

    it('should add game component to empty entity', () => {
      store.getState().addGameComponent('entity-1', characterController);

      const state = store.getState();
      expect(state.allGameComponents['entity-1']).toEqual([characterController]);

      expect(mockDispatch).toHaveBeenCalledWith('add_game_component', {
        entityId: 'entity-1',
        component: characterController,
      });
    });

    it('should add game component to existing entity', () => {
      store.getState().addGameComponent('entity-1', characterController);
      store.getState().addGameComponent('entity-1', health);

      const state = store.getState();
      expect(state.allGameComponents['entity-1']).toEqual([characterController, health]);

      expect(mockDispatch).toHaveBeenCalledTimes(2);
      expect(mockDispatch).toHaveBeenLastCalledWith('add_game_component', {
        entityId: 'entity-1',
        component: health,
      });
    });

    it('should update game component by type', () => {
      store.getState().addGameComponent('entity-1', characterController);

      const updatedController: GameComponentData = {
        type: 'characterController',
        characterController: {
          speed: 8.0,
          jumpHeight: 3.0,
          gravityScale: 1.0,
          canDoubleJump: true,
        },
      };

      store.getState().updateGameComponent('entity-1', updatedController);

      const state = store.getState();
      expect(state.allGameComponents['entity-1']).toEqual([updatedController]);

      expect(mockDispatch).toHaveBeenLastCalledWith('update_game_component', {
        entityId: 'entity-1',
        component: updatedController,
      });
    });

    it('should remove game component by type', () => {
      store.getState().addGameComponent('entity-1', characterController);
      store.getState().addGameComponent('entity-1', health);

      store.getState().removeGameComponent('entity-1', 'characterController');

      const state = store.getState();
      expect(state.allGameComponents['entity-1']).toEqual([health]);

      expect(mockDispatch).toHaveBeenLastCalledWith('remove_game_component', {
        entityId: 'entity-1',
        componentName: 'characterController',
      });
    });

    it('should handle removing non-existent component gracefully', () => {
      store.getState().addGameComponent('entity-1', characterController);

      store.getState().removeGameComponent('entity-1', 'nonExistent');

      const state = store.getState();
      expect(state.allGameComponents['entity-1']).toEqual([characterController]);

      expect(mockDispatch).toHaveBeenLastCalledWith('remove_game_component', {
        entityId: 'entity-1',
        componentName: 'nonExistent',
      });
    });
  });

  describe('Game Cameras', () => {
    const thirdPersonCamera: GameCameraData = {
      mode: 'thirdPersonFollow',
      targetEntity: null,
      followDistance: 5.0,
      followHeight: 2.0,
      followSmoothing: 0.8,
    };

    const firstPersonCamera: GameCameraData = {
      mode: 'firstPerson',
      targetEntity: null,
      firstPersonMouseSensitivity: 0.5,
    };

    it('should set game camera and dispatch', () => {
      store.getState().setGameCamera('entity-1', thirdPersonCamera);

      const state = store.getState();
      expect(state.allGameCameras['entity-1']).toEqual(thirdPersonCamera);

      expect(mockDispatch).toHaveBeenCalledWith('set_game_camera', {
        entityId: 'entity-1',
        ...thirdPersonCamera,
      });
    });

    it('should remove game camera', () => {
      store.getState().setGameCamera('entity-1', thirdPersonCamera);
      expect(store.getState().allGameCameras['entity-1']).toBeDefined();

      store.getState().removeGameCamera('entity-1');

      const state = store.getState();
      expect(state.allGameCameras['entity-1']).toBeUndefined();

      expect(mockDispatch).toHaveBeenLastCalledWith('remove_game_camera', {
        entityId: 'entity-1',
      });
    });

    it('should set active game camera and dispatch', () => {
      store.getState().setGameCamera('entity-1', thirdPersonCamera);

      store.getState().setActiveGameCamera('entity-1');

      const state = store.getState();
      expect(state.activeGameCameraId).toBe('entity-1');

      expect(mockDispatch).toHaveBeenLastCalledWith('set_active_game_camera', {
        entityId: 'entity-1',
      });
    });

    it('should clear active game camera with null', () => {
      store.getState().setActiveGameCamera('entity-1');
      expect(store.getState().activeGameCameraId).toBe('entity-1');

      store.getState().setActiveGameCamera(null);

      const state = store.getState();
      expect(state.activeGameCameraId).toBeNull();

      expect(mockDispatch).toHaveBeenLastCalledWith('set_active_game_camera', {
        entityId: null,
      });
    });

    it('should dispatch camera shake without state change', () => {
      store.getState().cameraShake('entity-1', 0.5, 1.0);

      expect(mockDispatch).toHaveBeenCalledWith('camera_shake', {
        entityId: 'entity-1',
        intensity: 0.5,
        duration: 1.0,
      });
    });

    it('should set entity game camera (primaryGameCamera) without dispatch', () => {
      store.getState().setEntityGameCamera('entity-1', thirdPersonCamera);

      const state = store.getState();
      expect(state.primaryGameCamera).toEqual(thirdPersonCamera);

      expect(mockDispatch).not.toHaveBeenCalled();
    });

    it('should clear entity game camera with null', () => {
      store.getState().setEntityGameCamera('entity-1', thirdPersonCamera);
      expect(store.getState().primaryGameCamera).toEqual(thirdPersonCamera);

      store.getState().setEntityGameCamera('entity-1', null);

      const state = store.getState();
      expect(state.primaryGameCamera).toBeNull();
    });

    it('should set active game camera ID without dispatch', () => {
      store.getState().setActiveGameCameraId('entity-1');

      const state = store.getState();
      expect(state.activeGameCameraId).toBe('entity-1');

      expect(mockDispatch).not.toHaveBeenCalled();
    });

    it('should update multiple cameras', () => {
      store.getState().setGameCamera('entity-1', thirdPersonCamera);
      store.getState().setGameCamera('entity-2', firstPersonCamera);

      const state = store.getState();
      expect(state.allGameCameras['entity-1']).toEqual(thirdPersonCamera);
      expect(state.allGameCameras['entity-2']).toEqual(firstPersonCamera);
      expect(Object.keys(state.allGameCameras)).toHaveLength(2);
    });
  });

  describe('Mobile Controls', () => {
    const customConfig: MobileTouchConfig = {
      enabled: false,
      autoDetect: false,
      preset: 'shooter',
      joystick: {
        position: 'bottom-right',
        size: 100,
        deadZone: 0.2,
        opacity: 0.8,
        mode: 'fixed',
        actions: { horizontal: 'strafe', vertical: 'forward' },
      },
      buttons: [
        { id: 'shoot', action: 'attack', position: { x: 90, y: 80 }, size: 70, icon: '🔫', opacity: 0.7 },
        { id: 'reload', action: 'reload', position: { x: 90, y: 60 }, size: 60, icon: 'R', opacity: 0.6 },
      ],
      preferredOrientation: 'landscape',
      autoReduceQuality: false,
    };

    it('should set mobile touch config', () => {
      store.getState().setMobileTouchConfig(customConfig);

      const state = store.getState();
      expect(state.mobileTouchConfig).toEqual(customConfig);

      expect(mockDispatch).not.toHaveBeenCalled();
    });

    it('should update mobile touch config with partial', () => {
      const partial: Partial<MobileTouchConfig> = {
        enabled: false,
        preset: 'runner',
        autoReduceQuality: false,
      };

      store.getState().updateMobileTouchConfig(partial);

      const state = store.getState();
      expect(state.mobileTouchConfig.enabled).toBe(false);
      expect(state.mobileTouchConfig.preset).toBe('runner');
      expect(state.mobileTouchConfig.autoReduceQuality).toBe(false);
      // Other fields should remain at default
      expect(state.mobileTouchConfig.autoDetect).toBe(true);
      expect(state.mobileTouchConfig.joystick!.position).toBe('bottom-left');

      expect(mockDispatch).not.toHaveBeenCalled();
    });

    it('should preserve unchanged fields when updating partial', () => {
      store.getState().setMobileTouchConfig(customConfig);

      const partial: Partial<MobileTouchConfig> = {
        preferredOrientation: 'portrait',
      };

      store.getState().updateMobileTouchConfig(partial);

      const state = store.getState();
      expect(state.mobileTouchConfig.preferredOrientation).toBe('portrait');
      expect(state.mobileTouchConfig.enabled).toBe(false); // Unchanged from customConfig
      expect(state.mobileTouchConfig.preset).toBe('shooter'); // Unchanged from customConfig
    });
  });

  describe('Engine Mode', () => {
    it('should dispatch play command without state change', () => {
      store.getState().play();

      expect(mockDispatch).toHaveBeenCalledWith('play', {});
      expect(store.getState().engineMode).toBe('edit'); // State unchanged
    });

    it('should dispatch stop command without state change', () => {
      store.getState().stop();

      expect(mockDispatch).toHaveBeenCalledWith('stop', {});
      expect(store.getState().engineMode).toBe('edit'); // State unchanged
    });

    it('should dispatch pause command without state change', () => {
      store.getState().pause();

      expect(mockDispatch).toHaveBeenCalledWith('pause', {});
      expect(store.getState().engineMode).toBe('edit'); // State unchanged
    });

    it('should dispatch resume command without state change', () => {
      store.getState().resume();

      expect(mockDispatch).toHaveBeenCalledWith('resume', {});
      expect(store.getState().engineMode).toBe('edit'); // State unchanged
    });

    it('should set engine mode to play without dispatch', () => {
      store.getState().setEngineMode('play');

      const state = store.getState();
      expect(state.engineMode).toBe('play');

      expect(mockDispatch).not.toHaveBeenCalled();
    });

    it('should set engine mode to paused without dispatch', () => {
      store.getState().setEngineMode('paused');

      const state = store.getState();
      expect(state.engineMode).toBe('paused');

      expect(mockDispatch).not.toHaveBeenCalled();
    });

    it('should set engine mode to edit without dispatch', () => {
      store.getState().setEngineMode('play');
      expect(store.getState().engineMode).toBe('play');

      store.getState().setEngineMode('edit');

      const state = store.getState();
      expect(state.engineMode).toBe('edit');

      expect(mockDispatch).not.toHaveBeenCalled();
    });
  });

  describe('HUD', () => {
    const hudElements: HudElement[] = [
      {
        id: 'health-bar',
        text: 'Health: 100',
        x: 10,
        y: 10,
        fontSize: 16,
        color: '#ff0000',
        visible: true,
      },
      {
        id: 'score-text',
        text: 'Score: 0',
        x: 50,
        y: 50,
        visible: true,
      },
    ];

    it('should set HUD elements without dispatch', () => {
      store.getState().setHudElements(hudElements);

      const state = store.getState();
      expect(state.hudElements).toEqual(hudElements);

      expect(mockDispatch).not.toHaveBeenCalled();
    });

    it('should replace HUD elements', () => {
      store.getState().setHudElements(hudElements);
      expect(store.getState().hudElements).toHaveLength(2);

      const newElements: HudElement[] = [
        {
          id: 'timer',
          text: '00:00',
          x: 100,
          y: 20,
          visible: true,
        },
      ];

      store.getState().setHudElements(newElements);

      const state = store.getState();
      expect(state.hudElements).toEqual(newElements);
      expect(state.hudElements).toHaveLength(1);
    });

    it('should clear HUD elements with empty array', () => {
      store.getState().setHudElements(hudElements);
      expect(store.getState().hudElements).toHaveLength(2);

      store.getState().setHudElements([]);

      const state = store.getState();
      expect(state.hudElements).toEqual([]);
    });
  });
});
