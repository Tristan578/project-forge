import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createSliceStore, createMockDispatch } from './sliceTestTemplate';
import { createGameSlice, setGameDispatcher, type GameSlice } from '../gameSlice';
import type { GameCameraData, GameCameraMode } from '../types';

/**
 * Tests for game camera modes and mode-specific parameters (PF-157).
 */
describe('gameCameraModes', () => {
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

  describe('thirdPersonFollow mode', () => {
    const thirdPerson: GameCameraData = {
      mode: 'thirdPersonFollow',
      targetEntity: 'player-1',
      followDistance: 8.0,
      followHeight: 3.0,
      followLookAhead: 2.0,
      followSmoothing: 0.9,
    };

    it('should store all thirdPersonFollow parameters', () => {
      store.getState().setGameCamera('cam-1', thirdPerson);

      const cam = store.getState().allGameCameras['cam-1'];
      expect(cam.mode).toBe('thirdPersonFollow');
      expect(cam.targetEntity).toBe('player-1');
      expect(cam.followDistance).toBe(8.0);
      expect(cam.followHeight).toBe(3.0);
      expect(cam.followLookAhead).toBe(2.0);
      expect(cam.followSmoothing).toBe(0.9);
    });

    it('should dispatch with all mode parameters', () => {
      store.getState().setGameCamera('cam-1', thirdPerson);

      expect(mockDispatch).toHaveBeenCalledWith('set_game_camera', {
        entityId: 'cam-1',
        ...thirdPerson,
      });
    });
  });

  describe('firstPerson mode', () => {
    const firstPerson: GameCameraData = {
      mode: 'firstPerson',
      targetEntity: 'player-1',
      firstPersonHeight: 1.7,
      firstPersonMouseSensitivity: 0.3,
    };

    it('should store firstPerson parameters', () => {
      store.getState().setGameCamera('cam-1', firstPerson);

      const cam = store.getState().allGameCameras['cam-1'];
      expect(cam.mode).toBe('firstPerson');
      expect(cam.firstPersonHeight).toBe(1.7);
      expect(cam.firstPersonMouseSensitivity).toBe(0.3);
    });

    it('should dispatch firstPerson camera correctly', () => {
      store.getState().setGameCamera('cam-1', firstPerson);

      expect(mockDispatch).toHaveBeenCalledWith('set_game_camera', {
        entityId: 'cam-1',
        ...firstPerson,
      });
    });
  });

  describe('sideScroller mode', () => {
    const sideScroller: GameCameraData = {
      mode: 'sideScroller',
      targetEntity: 'player-1',
      sideScrollerDistance: 15.0,
      sideScrollerHeight: 2.0,
    };

    it('should store sideScroller parameters', () => {
      store.getState().setGameCamera('cam-1', sideScroller);

      const cam = store.getState().allGameCameras['cam-1'];
      expect(cam.mode).toBe('sideScroller');
      expect(cam.sideScrollerDistance).toBe(15.0);
      expect(cam.sideScrollerHeight).toBe(2.0);
    });
  });

  describe('topDown mode', () => {
    const topDown: GameCameraData = {
      mode: 'topDown',
      targetEntity: 'player-1',
      topDownHeight: 20.0,
      topDownAngle: 75.0,
    };

    it('should store topDown parameters', () => {
      store.getState().setGameCamera('cam-1', topDown);

      const cam = store.getState().allGameCameras['cam-1'];
      expect(cam.mode).toBe('topDown');
      expect(cam.topDownHeight).toBe(20.0);
      expect(cam.topDownAngle).toBe(75.0);
    });
  });

  describe('fixed mode', () => {
    const fixed: GameCameraData = {
      mode: 'fixed',
      targetEntity: null,
    };

    it('should store fixed camera with no target', () => {
      store.getState().setGameCamera('cam-1', fixed);

      const cam = store.getState().allGameCameras['cam-1'];
      expect(cam.mode).toBe('fixed');
      expect(cam.targetEntity).toBeNull();
    });
  });

  describe('orbital mode', () => {
    const orbital: GameCameraData = {
      mode: 'orbital',
      targetEntity: 'showcase-item',
      orbitalDistance: 5.0,
      orbitalAutoRotateSpeed: 0.5,
    };

    it('should store orbital parameters', () => {
      store.getState().setGameCamera('cam-1', orbital);

      const cam = store.getState().allGameCameras['cam-1'];
      expect(cam.mode).toBe('orbital');
      expect(cam.orbitalDistance).toBe(5.0);
      expect(cam.orbitalAutoRotateSpeed).toBe(0.5);
    });
  });

  describe('Mode Switching', () => {
    it('should switch from thirdPerson to firstPerson', () => {
      store.getState().setGameCamera('cam-1', {
        mode: 'thirdPersonFollow',
        targetEntity: 'player',
        followDistance: 5.0,
        followHeight: 2.0,
      });

      store.getState().setGameCamera('cam-1', {
        mode: 'firstPerson',
        targetEntity: 'player',
        firstPersonHeight: 1.7,
        firstPersonMouseSensitivity: 0.5,
      });

      const cam = store.getState().allGameCameras['cam-1'];
      expect(cam.mode).toBe('firstPerson');
      expect(cam.firstPersonHeight).toBe(1.7);
      // Old thirdPerson params should be replaced
      expect(cam.followDistance).toBeUndefined();
    });

    it('should switch between all 6 modes', () => {
      const modes: GameCameraMode[] = ['thirdPersonFollow', 'firstPerson', 'sideScroller', 'topDown', 'fixed', 'orbital'];

      for (const mode of modes) {
        store.getState().setGameCamera('cam-1', {
          mode,
          targetEntity: 'player',
        });

        const cam = store.getState().allGameCameras['cam-1'];
        expect(cam.mode).toBe(mode);
      }

      expect(mockDispatch).toHaveBeenCalledTimes(6);
    });
  });

  describe('Multiple Cameras', () => {
    it('should manage cameras per entity independently', () => {
      store.getState().setGameCamera('cam-main', {
        mode: 'thirdPersonFollow',
        targetEntity: 'player',
        followDistance: 5.0,
      });

      store.getState().setGameCamera('cam-cutscene', {
        mode: 'fixed',
        targetEntity: null,
      });

      store.getState().setGameCamera('cam-orbit', {
        mode: 'orbital',
        targetEntity: 'item',
        orbitalDistance: 3.0,
      });

      const cameras = store.getState().allGameCameras;
      expect(Object.keys(cameras)).toHaveLength(3);
      expect(cameras['cam-main'].mode).toBe('thirdPersonFollow');
      expect(cameras['cam-cutscene'].mode).toBe('fixed');
      expect(cameras['cam-orbit'].mode).toBe('orbital');
    });

    it('should switch active camera between entities', () => {
      store.getState().setGameCamera('cam-1', { mode: 'thirdPersonFollow', targetEntity: 'p' });
      store.getState().setGameCamera('cam-2', { mode: 'fixed', targetEntity: null });

      store.getState().setActiveGameCamera('cam-1');
      expect(store.getState().activeGameCameraId).toBe('cam-1');

      store.getState().setActiveGameCamera('cam-2');
      expect(store.getState().activeGameCameraId).toBe('cam-2');
    });

    it('should remove camera while keeping others', () => {
      store.getState().setGameCamera('cam-1', { mode: 'firstPerson', targetEntity: 'p' });
      store.getState().setGameCamera('cam-2', { mode: 'topDown', targetEntity: 'p' });
      store.getState().setGameCamera('cam-3', { mode: 'orbital', targetEntity: 'item' });

      store.getState().removeGameCamera('cam-2');

      const cameras = store.getState().allGameCameras;
      expect(Object.keys(cameras)).toHaveLength(2);
      expect(cameras['cam-1']).toEqual(expect.objectContaining({ mode: 'firstPerson' }));
      expect(cameras['cam-2']).toBeUndefined();
      expect(cameras['cam-3']).toEqual(expect.objectContaining({ mode: 'orbital' }));
    });
  });

  describe('Camera Shake', () => {
    it('should dispatch camera shake with correct params', () => {
      store.getState().cameraShake('cam-1', 0.8, 2.0);

      expect(mockDispatch).toHaveBeenCalledWith('camera_shake', {
        entityId: 'cam-1',
        intensity: 0.8,
        duration: 2.0,
      });
    });

    it('should dispatch shake with zero intensity', () => {
      store.getState().cameraShake('cam-1', 0, 1.0);

      expect(mockDispatch).toHaveBeenCalledWith('camera_shake', {
        entityId: 'cam-1',
        intensity: 0,
        duration: 1.0,
      });
    });

    it('should not change state on camera shake', () => {
      const before = store.getState().allGameCameras;
      store.getState().cameraShake('cam-1', 1.0, 0.5);
      const after = store.getState().allGameCameras;
      expect(before).toEqual(after);
    });
  });

  describe('Primary Game Camera', () => {
    it('should set primaryGameCamera via setEntityGameCamera', () => {
      const cam: GameCameraData = {
        mode: 'thirdPersonFollow',
        targetEntity: 'player',
        followDistance: 5.0,
        followHeight: 2.0,
        followSmoothing: 0.8,
      };

      store.getState().setEntityGameCamera('cam-1', cam);

      expect(store.getState().primaryGameCamera).toEqual(cam);
      // Should not dispatch (state-only operation)
      expect(mockDispatch).not.toHaveBeenCalled();
    });

    it('should clear primaryGameCamera with null', () => {
      store.getState().setEntityGameCamera('cam-1', {
        mode: 'orbital',
        targetEntity: 'item',
        orbitalDistance: 5.0,
      });

      store.getState().setEntityGameCamera('cam-1', null);

      expect(store.getState().primaryGameCamera).toBeNull();
    });

    it('should set activeGameCameraId without dispatch', () => {
      store.getState().setActiveGameCameraId('cam-1');
      expect(store.getState().activeGameCameraId).toBe('cam-1');
      expect(mockDispatch).not.toHaveBeenCalled();
    });
  });

  describe('Loading Screen Config', () => {
    it('should set loading screen config', () => {
      store.getState().setLoadingScreenConfig({
        backgroundColor: '#1a1a2e',
        progressBarColor: '#e94560',
        progressStyle: 'bar',
        title: 'Loading...',
        subtitle: 'Please wait',
      });

      const config = store.getState().loadingScreenConfig;
      expect(config).not.toBeNull();
      expect(config!.title).toBe('Loading...');
      expect(config!.progressStyle).toBe('bar');
    });

    it('should clear loading screen config', () => {
      store.getState().setLoadingScreenConfig({
        backgroundColor: '#000',
        progressBarColor: '#fff',
        progressStyle: 'spinner',
        title: 'test',
      });

      store.getState().setLoadingScreenConfig(null);
      expect(store.getState().loadingScreenConfig).toBeNull();
    });
  });

  describe('Accessibility Profile (#8207)', () => {
    const mockProfile = {
      colorblindMode: { enabled: true, mode: 'protanopia' as const, filterStrength: 0.8 },
      screenReader: { enabled: true, entityDescriptions: new Map(), navigationAnnouncements: true },
      inputRemapping: { enabled: false, remappings: [], onScreenControls: false },
      subtitles: { enabled: false, fontSize: 'medium' as const, backgroundColor: '#000', textColor: '#fff', opacity: 1 },
      fontSize: { enabled: false, scale: 1.0, minSize: 12 },
    };

    it('should default accessibilityProfile to null', () => {
      expect(store.getState().accessibilityProfile).toBeNull();
    });

    it('should set accessibility profile', () => {
      store.getState().setAccessibilityProfile(mockProfile);
      expect(store.getState().accessibilityProfile).toEqual(mockProfile);
    });

    it('should clear accessibility profile', () => {
      store.getState().setAccessibilityProfile(mockProfile);
      store.getState().setAccessibilityProfile(null);
      expect(store.getState().accessibilityProfile).toBeNull();
    });

    it('should update partial accessibility profile', () => {
      store.getState().setAccessibilityProfile(mockProfile);
      store.getState().updateAccessibilityProfile({
        colorblindMode: { enabled: false, mode: 'deuteranopia', filterStrength: 1.0 },
      });
      const updated = store.getState().accessibilityProfile;
      expect(updated!.colorblindMode.mode).toBe('deuteranopia');
      expect(updated!.colorblindMode.enabled).toBe(false);
      // Other fields unchanged
      expect(updated!.screenReader.enabled).toBe(true);
    });

    it('should initialize from defaults when updating null profile', () => {
      store.getState().updateAccessibilityProfile({
        colorblindMode: { enabled: true, mode: 'tritanopia', filterStrength: 0.5 },
      });
      const result = store.getState().accessibilityProfile;
      // Profile initialized from defaults, then merged with partial
      expect(result).not.toBeNull();
      expect(result!.colorblindMode.mode).toBe('tritanopia');
      expect(result!.colorblindMode.enabled).toBe(true);
      // Other fields get defaults
      expect(result!.screenReader).toBeDefined();
    });
  });

  describe('Export Preset', () => {
    it('should set export preset', () => {
      const preset = {
        name: 'Web Optimized',
        description: 'Test',
        format: 'zip' as const,
        includeSourceMaps: false,
        compressTextures: true,
        resolution: 'responsive' as const,
        includeDebug: false,
        loadingScreen: {
          backgroundColor: '#1a1a1a',
          progressBarColor: '#6366f1',
          progressStyle: 'bar' as const,
        },
      };
      store.getState().setExportPreset('web-optimized', preset);
      expect(store.getState().exportPreset).toEqual({ presetKey: 'web-optimized', config: preset });
    });

    it('should clear export preset', () => {
      store.getState().setExportPreset('web-optimized', {
        name: 'Web Optimized',
        description: 'Test',
        format: 'zip' as const,
        includeSourceMaps: false,
        compressTextures: true,
        resolution: 'responsive' as const,
        includeDebug: false,
        loadingScreen: {
          backgroundColor: '#1a1a1a',
          progressBarColor: '#6366f1',
          progressStyle: 'bar' as const,
        },
      });

      store.getState().clearExportPreset();
      expect(store.getState().exportPreset).toBeNull();
    });

    it('should default to null', () => {
      expect(store.getState().exportPreset).toBeNull();
    });
  });
});
