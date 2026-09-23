import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createSliceStore, createMockDispatch } from './sliceTestTemplate';
import { createGameSlice, setGameDispatcher, setWinnabilityStateReader, type GameSlice } from '../gameSlice';
import type { GameComponentData, GameCameraData, MobileTouchConfig, HudElement, SceneGraph } from '../types';
import { buildStoreComponentWithReport } from '@/lib/engine/gameComponentWire';
import { componentAdjustmentsOf } from '@/lib/engine/gameComponentCorrections';

const { chatSetState, chatGetState } = vi.hoisted(() => ({
  chatSetState: vi.fn(),
  chatGetState: vi.fn(() => ({ messages: [] as unknown[] })),
}));
vi.mock('@/stores/chatStore', () => ({
  useChatStore: { getState: chatGetState, setState: chatSetState },
}));

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
    setWinnabilityStateReader(null);
    chatSetState.mockClear();
    chatGetState.mockClear();
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

    it('should not be won and have zero score', () => {
      const state = store.getState();
      expect(state.gameWon).toBe(false);
      expect(state.gameScore).toBe(0);
    });
  });

  describe('Win State', () => {
    it('should set gameWon without dispatch', () => {
      store.getState().setGameWon(true);

      const state = store.getState();
      expect(state.gameWon).toBe(true);
      expect(mockDispatch).not.toHaveBeenCalled();
    });

    it('should set gameScore without dispatch', () => {
      store.getState().setGameScore(42);

      const state = store.getState();
      expect(state.gameScore).toBe(42);
      expect(mockDispatch).not.toHaveBeenCalled();
    });

    it('should reset win/score when starting play', () => {
      store.getState().setGameWon(true);
      store.getState().setGameScore(99);

      store.getState().play();

      const state = store.getState();
      expect(state.gameWon).toBe(false);
      expect(state.gameScore).toBe(0);
      expect(mockDispatch).toHaveBeenCalledWith('play', {});
    });

    it('should reset win/score when stopping play', () => {
      store.getState().setGameWon(true);
      store.getState().setGameScore(99);

      store.getState().stop();

      const state = store.getState();
      expect(state.gameWon).toBe(false);
      expect(state.gameScore).toBe(0);
      expect(mockDispatch).toHaveBeenCalledWith('stop', {});
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
        despawnOnDeath: true,
      },
    };

    it('should add game component to empty entity', () => {
      store.getState().addGameComponent('entity-1', characterController);

      const state = store.getState();
      expect(state.allGameComponents['entity-1']).toEqual([characterController]);

      // The engine takes `{ entityId, componentType, properties }` — the store's
      // tagged union is rejected outright ("Missing componentType").
      expect(mockDispatch).toHaveBeenCalledWith('add_game_component', {
        entityId: 'entity-1',
        componentType: 'character_controller',
        properties: characterController.characterController,
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
        componentType: 'health',
        properties: health.health,
      });
    });

    it('replaces rather than duplicates when the same type is added twice', () => {
      // `build_game_component` keys on `componentType` and OVERWRITES, so the
      // engine holds exactly one component per type. An unconditional push left
      // the store holding two after any re-run of a step that adds one — and the
      // generation pipeline is retryable, so this is a reachable state, not a
      // hypothetical. Nothing would report the divergence: `dispatchCommand`
      // returns void.
      const faster: GameComponentData = {
        type: 'characterController',
        characterController: {
          speed: 12.0,
          jumpHeight: 4.0,
          gravityScale: 1.0,
          canDoubleJump: false,
        },
      };

      store.getState().addGameComponent('entity-1', characterController);
      store.getState().addGameComponent('entity-1', health);
      store.getState().addGameComponent('entity-1', faster);

      // The survivor is the LAST write, matching what the engine now holds, and
      // the unrelated component is untouched.
      expect(store.getState().allGameComponents['entity-1']).toEqual([health, faster]);
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
        componentType: 'character_controller',
        properties: updatedController.characterController,
      });
    });

    // The inspector's Value / Max Count fields are plain number inputs, so a typed
    // `10.4` reaches the store verbatim. Those two fields (and `targetScore`) are
    // `u32` in the engine, which rounds and clamps them — leaving the store holding
    // a number the running game never uses, with nothing to report the mismatch.
    it('should coerce whole-number fields to what the engine will hold', () => {
      store.getState().addGameComponent('entity-1', {
        type: 'collectible',
        collectible: {
          value: 10.4,
          destroyOnCollect: true,
          pickupSoundAsset: null,
          rotateSpeed: 90,
        },
      });

      const stored = store.getState().allGameComponents['entity-1'][0];
      expect(stored.type === 'collectible' && stored.collectible.value).toBe(10);
      expect(mockDispatch).toHaveBeenLastCalledWith('add_game_component', {
        entityId: 'entity-1',
        componentType: 'collectible',
        properties: expect.objectContaining({ value: 10 }),
      });
    });

    it('should coerce whole-number fields on update as well as add', () => {
      store.getState().addGameComponent('entity-1', {
        type: 'spawner',
        spawner: {
          entityType: 'cube',
          intervalSecs: 3,
          maxCount: 5,
          spawnOffset: [0, 1, 0],
          onTrigger: null,
        },
      });
      store.getState().updateGameComponent('entity-1', {
        type: 'spawner',
        spawner: {
          entityType: 'cube',
          intervalSecs: 2.5,
          maxCount: 5000,
          spawnOffset: [0, 1, 0],
          onTrigger: null,
        },
      });

      const stored = store.getState().allGameComponents['entity-1'][0];
      expect(stored.type === 'spawner' && stored.spawner.maxCount).toBe(1000);
      // A float field alongside it must stay fractional — the coercion is per
      // field, not per component.
      expect(stored.type === 'spawner' && stored.spawner.intervalSecs).toBe(2.5);
      expect(mockDispatch).toHaveBeenLastCalledWith('update_game_component', {
        entityId: 'entity-1',
        componentType: 'spawner',
        properties: expect.objectContaining({ maxCount: 1000, intervalSecs: 2.5 }),
      });
    });

    it('should remove game component by type', () => {
      store.getState().addGameComponent('entity-1', characterController);
      store.getState().addGameComponent('entity-1', health);

      store.getState().removeGameComponent('entity-1', 'characterController');

      const state = store.getState();
      expect(state.allGameComponents['entity-1']).toEqual([health]);

      // Normalized to the engine's vocabulary — `component_name()` is snake_case.
      expect(mockDispatch).toHaveBeenLastCalledWith('remove_game_component', {
        entityId: 'entity-1',
        componentName: 'character_controller',
      });
    });

    it('should remove game component when named the way the engine names it', () => {
      // The inspector removes by the engine's snake_case name. Comparing that
      // directly against the store's camelCase discriminant never matched, which
      // is why the inspector's Remove button did nothing for all 13 types.
      store.getState().addGameComponent('entity-1', characterController);
      store.getState().addGameComponent('entity-1', health);

      store.getState().removeGameComponent('entity-1', 'character_controller');

      expect(store.getState().allGameComponents['entity-1']).toEqual([health]);
      expect(mockDispatch).toHaveBeenLastCalledWith('remove_game_component', {
        entityId: 'entity-1',
        componentName: 'character_controller',
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

  // PF-1148: the per-field record of "asked for X, applied Y" the inspector marks
  // fields from. Ephemeral editor state — it never rides inside a component, a
  // wire payload or anything a scene save reads.
  describe('Game component adjustments', () => {
    const route = (n: number): [number, number, number][] =>
      Array.from({ length: n }, (_, i) => [i, 0, 0] as [number, number, number]);

    function platformFromTool(props: Record<string, unknown>) {
      const built = buildStoreComponentWithReport('moving_platform', props);
      if (built === null) throw new Error('moving_platform did not build');
      return built;
    }

    const adjustmentsOf = (entityId: string, type: GameComponentData['type']) =>
      componentAdjustmentsOf(store.getState().gameComponentAdjustments, entityId, type);

    it('starts with no adjustments', () => {
      expect(store.getState().gameComponentAdjustments).toEqual({});
    });

    it('records the corrections a tool call caused, field by field', () => {
      const built = platformFromTool({ speed: 99999, waypoints: route(300) });
      store.getState().addGameComponent('e1', built.component, built);

      expect(adjustmentsOf('e1', 'movingPlatform')).toEqual({
        speed: { component: 'movingPlatform', field: 'speed', requested: 99999, applied: 1000, reason: 'clamped' },
        waypoints: {
          component: 'movingPlatform', field: 'waypoints', requested: 300, applied: 64, reason: 'truncated', unit: 'points',
          appliedPoints: route(64),
        },
      });
    });

    it('records nothing for an in-range write', () => {
      const built = platformFromTool({ speed: 6, waypoints: route(3) });
      expect(built.corrections).toEqual([]);
      store.getState().addGameComponent('e1', built.component, built);
      expect(store.getState().gameComponentAdjustments).toEqual({});
      // And the write itself landed — an empty map is not a skipped write.
      const stored = store.getState().allGameComponents['e1'][0];
      expect(stored.type === 'movingPlatform' && stored.movingPlatform.speed).toBe(6);
    });

    it('records the store’s own coercion of a raw value, with no report passed in', () => {
      // The inspector hands the store a whole component and no report; a 10.4 in
      // a whole-number field is still a value the author asked for and did not get.
      store.getState().addGameComponent('e1', {
        type: 'collectible',
        collectible: { value: 10.4, destroyOnCollect: true, pickupSoundAsset: null, rotateSpeed: 90 },
      });
      expect(adjustmentsOf('e1', 'collectible')).toEqual({
        value: { component: 'collectible', field: 'value', requested: 10.4, applied: 10, reason: 'rounded' },
      });
    });

    it('keeps the corrections out of the stored component and the engine payload', () => {
      const built = platformFromTool({ speed: 99999 });
      store.getState().addGameComponent('e1', built.component, built);

      // Exactly the four fields, nothing smuggled in beside them — this object is
      // what the winnability gate, the chat context and the scene tools read.
      const stored = store.getState().allGameComponents['e1'][0];
      expect(stored).toEqual({
        type: 'movingPlatform',
        movingPlatform: { speed: 1000, waypoints: [[0, 0, 0], [0, 3, 0]], pauseDuration: 0.5, loopMode: 'pingPong' },
      });
      expect(mockDispatch).toHaveBeenLastCalledWith('add_game_component', {
        entityId: 'e1',
        componentType: 'moving_platform',
        properties: { speed: 1000, waypoints: [[0, 0, 0], [0, 3, 0]], pauseDuration: 0.5, loopMode: 'pingPong' },
      });
    });

    it('refuses a report whose applied value the stored field does not hold', () => {
      const stale = platformFromTool({ speed: 99999 });
      const fresh = platformFromTool({ speed: 7 });
      // A caller pairing one write's report with another write's component.
      store.getState().addGameComponent('e1', fresh.component, stale);
      expect(store.getState().gameComponentAdjustments).toEqual({});
    });

    it('keeps a marker while a different field is edited, and clears it when its own field is', () => {
      const built = platformFromTool({ speed: 99999, waypoints: route(300) });
      store.getState().addGameComponent('e1', built.component, built);
      const current = store.getState().allGameComponents['e1'][0];
      if (current.type !== 'movingPlatform') throw new Error('expected a movingPlatform');

      // An inspector edit to the pause: both markers still describe their fields.
      store.getState().updateGameComponent('e1', {
        type: 'movingPlatform',
        movingPlatform: { ...current.movingPlatform, pauseDuration: 2 },
      });
      expect(Object.keys(adjustmentsOf('e1', 'movingPlatform') ?? {}).sort()).toEqual(['speed', 'waypoints']);

      // An inspector edit to the speed, in range: that marker is now false.
      store.getState().updateGameComponent('e1', {
        type: 'movingPlatform',
        movingPlatform: { ...current.movingPlatform, pauseDuration: 2, speed: 4 },
      });
      expect(Object.keys(adjustmentsOf('e1', 'movingPlatform') ?? {})).toEqual(['waypoints']);
    });

    it('clears a marker when a tool sets that field explicitly, even to the value it already held', () => {
      const first = platformFromTool({ speed: 99999 });
      store.getState().addGameComponent('e1', first.component, first);
      expect(adjustmentsOf('e1', 'movingPlatform')).toBeDefined();

      // "Set the speed to 1000" — no correction this time, and the marker saying
      // "you asked for 99999" is no longer what the author asked for.
      const second = platformFromTool({ speed: 1000 });
      store.getState().updateGameComponent('e1', second.component, second);
      expect(adjustmentsOf('e1', 'movingPlatform')).toBeUndefined();
    });

    it('replaces the markers on add, which replaces the whole component', () => {
      const first = platformFromTool({ speed: 99999 });
      store.getState().addGameComponent('e1', first.component, first);
      const second = platformFromTool({ waypoints: route(70) });
      store.getState().addGameComponent('e1', second.component, second);
      expect(Object.keys(adjustmentsOf('e1', 'movingPlatform') ?? {})).toEqual(['waypoints']);
    });

    it('drops a component’s markers when the component is removed', () => {
      const built = platformFromTool({ speed: 99999 });
      store.getState().addGameComponent('e1', built.component, built);
      store.getState().removeGameComponent('e1', 'moving_platform');
      expect(store.getState().gameComponentAdjustments).toEqual({});
    });

    it('keeps markers per entity', () => {
      const built = platformFromTool({ speed: 99999 });
      store.getState().addGameComponent('e1', built.component, built);
      store.getState().addGameComponent('e2', platformFromTool({}).component);
      expect(adjustmentsOf('e1', 'movingPlatform')).toBeDefined();
      expect(adjustmentsOf('e2', 'movingPlatform')).toBeUndefined();
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

      // The store keeps the authoring vocabulary; the wire carries the engine's.
      expect(mockDispatch).toHaveBeenCalledWith('set_game_camera', {
        entityId: 'entity-1',
        mode: 'thirdPersonFollow',
        targetEntity: null,
        offset: [0, 2.0, -5.0],
        damping: 0.8,
      });
    });

    it('should remove game camera', () => {
      store.getState().setGameCamera('entity-1', thirdPersonCamera);
      expect(store.getState().allGameCameras['entity-1']).toEqual(expect.objectContaining({ mode: thirdPersonCamera.mode }));

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

    it('should set entity game camera without dispatch', () => {
      store.getState().setEntityGameCamera('entity-1', thirdPersonCamera);

      const state = store.getState();
      expect(state.allGameCameras['entity-1']).toEqual(thirdPersonCamera);

      expect(mockDispatch).not.toHaveBeenCalled();
    });

    it('should clear entity game camera with null', () => {
      store.getState().setEntityGameCamera('entity-1', thirdPersonCamera);
      expect(store.getState().allGameCameras['entity-1']).toEqual(thirdPersonCamera);

      store.getState().setEntityGameCamera('entity-1', null);

      const state = store.getState();
      expect(state.allGameCameras['entity-1']).toBeUndefined();
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

  describe('Pre-play winnability gate', () => {
    const player: GameComponentData = {
      type: 'characterController',
      characterController: { speed: 5, jumpHeight: 2, gravityScale: 1, canDoubleJump: false },
    };
    const winnableReader = () => ({
      sceneGraph: {
        nodes: {
          player: { entityId: 'player', name: 'Player', parentId: null, children: [], components: [], visible: true },
          goal: { entityId: 'goal', name: 'Goal', parentId: null, children: [], components: [], visible: true },
        },
        rootIds: ['player', 'goal'],
      } as SceneGraph,
      allGameComponents: {
        player: [player],
        wc: [{ type: 'winCondition', winCondition: { conditionType: 'reachGoal', targetScore: null, targetEntityId: 'goal' } }] as GameComponentData[],
      },
    });

    it('dispatches play when the scene is winnable', () => {
      setWinnabilityStateReader(winnableReader);

      store.getState().play();

      expect(mockDispatch).toHaveBeenCalledWith('play', {});
    });

    it('dispatches play for a sandbox scene with no win condition (#9901)', () => {
      // The human Play gate must forward sceneGraph.completionMode into the
      // validator, not just pass the default 'win'. A sandbox scene with a
      // player and no win condition is intentionally complete and must play.
      // A regression that stops forwarding the mode (or forwards the wrong
      // property) would re-block this scene and turn this test red.
      setWinnabilityStateReader(() => ({
        sceneGraph: {
          nodes: {
            player: { entityId: 'player', name: 'Player', parentId: null, children: [], components: [], visible: true },
          },
          rootIds: ['player'],
          completionMode: 'sandbox',
        } as SceneGraph,
        allGameComponents: {
          player: [player],
        },
      }));

      store.getState().play();

      expect(mockDispatch).toHaveBeenCalledWith('play', {});
      // No winnability message is surfaced on the winnable path.
      expect(chatSetState).not.toHaveBeenCalled();
    });

    it('still blocks a malformed win condition even under a sandbox completionMode (#9901)', async () => {
      // The completionMode exemption only removes the "must have a win
      // condition" requirement; a win condition that IS present is validated in
      // every mode. A sandbox scene with a broken reachGoal target must still be
      // blocked, proving the mode is not a blanket bypass at the Play gate.
      setWinnabilityStateReader(() => ({
        sceneGraph: {
          nodes: {
            player: { entityId: 'player', name: 'Player', parentId: null, children: [], components: [], visible: true },
          },
          rootIds: ['player'],
          completionMode: 'sandbox',
        } as SceneGraph,
        allGameComponents: {
          player: [player],
          wc: [{ type: 'winCondition', winCondition: { conditionType: 'reachGoal', targetScore: null, targetEntityId: 'ghost' } }] as GameComponentData[],
        },
      }));

      store.getState().play();

      expect(mockDispatch).not.toHaveBeenCalledWith('play', {});
      await vi.waitFor(() => expect(chatSetState).toHaveBeenCalled());
    });

    it('blocks play and surfaces a chat message when the scene has no win condition', async () => {
      setWinnabilityStateReader(() => ({
        sceneGraph: { nodes: {}, rootIds: [] } as SceneGraph,
        allGameComponents: {},
      }));

      // play() is synchronous, but surfaceWinnabilityMessage dynamically imports
      // chatStore (a floating promise), so the chat write lands on a later
      // microtask — vi.waitFor polls until that async surface completes.
      store.getState().play();

      expect(mockDispatch).not.toHaveBeenCalledWith('play', {});
      await vi.waitFor(() => expect(chatSetState).toHaveBeenCalled());
      // surfaceWinnabilityMessage uses the updater form: setState((state) => next)
      const updater = chatSetState.mock.calls[0][0] as (
        state: { messages: unknown[] },
      ) => {
        rightPanelTab: string;
        hasUnreadMessages: boolean;
        messages: Array<{ role: string; content: string }>;
      };
      const payload = updater({ messages: [] });
      expect(payload.rightPanelTab).toBe('chat');
      // Switching to the chat tab makes the message immediately visible, so it
      // must NOT be flagged unread — that would badge the tab the user is now
      // viewing and break chatStore's tab==='chat' ⟹ unread-false invariant.
      expect(payload.hasUnreadMessages).toBe(false);
      // role:'system' — visible to the user, filtered out of the AI request.
      expect(payload.messages[0].role).toBe('system');
      expect(payload.messages[0].content).toContain("can't be won");
    });

    it('blocks play when a goal win condition targets a missing entity', async () => {
      setWinnabilityStateReader(() => ({
        sceneGraph: { nodes: {}, rootIds: [] } as SceneGraph,
        allGameComponents: {
          wc: [{ type: 'winCondition', winCondition: { conditionType: 'reachGoal', targetScore: null, targetEntityId: 'ghost' } }] as GameComponentData[],
        },
      }));

      store.getState().play();

      expect(mockDispatch).not.toHaveBeenCalledWith('play', {});
      await vi.waitFor(() => expect(chatSetState).toHaveBeenCalled());
    });

    it('skips the gate entirely when no reader is wired', () => {
      // Default: reader is null (cleared in afterEach) — legacy behavior.
      store.getState().play();
      expect(mockDispatch).toHaveBeenCalledWith('play', {});
    });

    it('fails open and dispatches play when the winnability reader throws', () => {
      // The gate is a UX safety net, never a lock: a bug in the reader or the
      // validator must NOT trap the user out of Play. play() catches and proceeds.
      setWinnabilityStateReader(() => {
        throw new Error('reader boom');
      });

      store.getState().play();

      expect(mockDispatch).toHaveBeenCalledWith('play', {});
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
