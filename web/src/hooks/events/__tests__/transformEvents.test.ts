// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockSetGet, createMockActions, type StoreState } from './eventTestUtils';

// Mock the editor store module
vi.mock('@/stores/editorStore', () => ({
  useEditorStore: {
    getState: vi.fn(),
    setState: vi.fn(),
    subscribe: vi.fn(),
  },
}));

import { useEditorStore } from '@/stores/editorStore';
import { handleTransformEvent } from '../transformEvents';

describe('handleTransformEvent', () => {
  let actions: ReturnType<typeof createMockActions>;
  let mockSetGet: ReturnType<typeof createMockSetGet>;

  beforeEach(() => {
    vi.clearAllMocks();
    actions = createMockActions();
    mockSetGet = createMockSetGet();
    vi.mocked(useEditorStore.getState).mockReturnValue(actions as unknown as StoreState);
  });

  it('returns false for unknown event types', () => {
    const result = handleTransformEvent(
      'UNKNOWN_EVENT',
      {},
      mockSetGet.set,
      mockSetGet.get
    );
    expect(result).toBe(false);
  });

  describe('SELECTION_CHANGED', () => {
    it('calls setSelection with selectedIds, primaryId, and primaryName', () => {
      const payload = {
        selectedIds: ['entity-1', 'entity-2'],
        primaryId: 'entity-1',
        primaryName: 'MyCube',
      };

      const result = handleTransformEvent(
        'SELECTION_CHANGED',
        payload,
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(true);
      expect(actions.setSelection).toHaveBeenCalledWith(
        ['entity-1', 'entity-2'],
        'entity-1',
        'MyCube'
      );
    });

    it('handles empty selection', () => {
      const payload = {
        selectedIds: [],
        primaryId: null,
        primaryName: null,
      };

      const result = handleTransformEvent(
        'SELECTION_CHANGED',
        payload,
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(true);
      expect(actions.setSelection).toHaveBeenCalledWith([], null, null);
    });
  });

  describe('SCENE_GRAPH_UPDATE', () => {
    it('calls setFullGraph with payload and marks scene as modified', () => {
      const sceneGraph = {
        entities: [
          { id: 'entity-1', name: 'Cube', entityType: 'cube', parentId: null },
        ],
      };

      const result = handleTransformEvent(
        'SCENE_GRAPH_UPDATE',
        sceneGraph,
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(true);
      expect(actions.setFullGraph).toHaveBeenCalledWith(sceneGraph);
      expect(useEditorStore.setState).toHaveBeenCalledWith({ sceneModified: true });
    });
  });

  describe('TRANSFORM_CHANGED', () => {
    it('calls setPrimaryTransform with the transform data', () => {
      const transformData = {
        position: { x: 1, y: 2, z: 3 },
        rotation: { x: 0, y: 45, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
      };

      const result = handleTransformEvent(
        'TRANSFORM_CHANGED',
        transformData,
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(true);
      expect(actions.setPrimaryTransform).toHaveBeenCalledWith(transformData);
    });
  });

  describe('HISTORY_CHANGED', () => {
    it('calls setHistoryState with canUndo, canRedo, and descriptions', () => {
      const payload = {
        canUndo: true,
        canRedo: false,
        undoDescription: 'Move Cube',
        redoDescription: null,
      };

      const result = handleTransformEvent(
        'HISTORY_CHANGED',
        payload,
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(true);
      expect(actions.setHistoryState).toHaveBeenCalledWith(
        true,
        false,
        'Move Cube',
        null
      );
    });

    it('handles both undo and redo available', () => {
      const payload = {
        canUndo: true,
        canRedo: true,
        undoDescription: 'Rename Entity',
        redoDescription: 'Scale Sphere',
      };

      const result = handleTransformEvent(
        'HISTORY_CHANGED',
        payload,
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(true);
      expect(actions.setHistoryState).toHaveBeenCalledWith(
        true,
        true,
        'Rename Entity',
        'Scale Sphere'
      );
    });
  });

  describe('SNAP_SETTINGS_CHANGED', () => {
    it('calls setSnapSettings with the snap settings payload', () => {
      const snapSettings = {
        positionSnap: true,
        rotationSnap: true,
        scaleSnap: false,
        positionStep: 0.5,
        rotationStep: 15,
        scaleStep: 0.1,
      };

      const result = handleTransformEvent(
        'SNAP_SETTINGS_CHANGED',
        snapSettings,
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(true);
      expect(actions.setSnapSettings).toHaveBeenCalledWith(snapSettings);
    });
  });

  describe('VIEW_PRESET_CHANGED', () => {
    it('calls setCurrentCameraPreset with the preset', () => {
      const payload = { preset: 'top', displayName: 'Top' };

      const result = handleTransformEvent(
        'VIEW_PRESET_CHANGED',
        payload,
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(true);
      expect(actions.setCurrentCameraPreset).toHaveBeenCalledWith('top');
    });

    it('handles null displayName', () => {
      const payload = { preset: 'perspective', displayName: null };

      const result = handleTransformEvent(
        'VIEW_PRESET_CHANGED',
        payload,
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(true);
      expect(actions.setCurrentCameraPreset).toHaveBeenCalledWith('perspective');
    });
  });

  describe('COORDINATE_MODE_CHANGED', () => {
    it('sets coordinateMode to world via setState', () => {
      const payload = { mode: 'world', displayName: 'World' };

      const result = handleTransformEvent(
        'COORDINATE_MODE_CHANGED',
        payload,
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(true);
      expect(useEditorStore.setState).toHaveBeenCalledWith({ coordinateMode: 'world' });
    });

    it('sets coordinateMode to local via setState', () => {
      const payload = { mode: 'local', displayName: 'Local' };

      const result = handleTransformEvent(
        'COORDINATE_MODE_CHANGED',
        payload,
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(true);
      expect(useEditorStore.setState).toHaveBeenCalledWith({ coordinateMode: 'local' });
    });
  });

  describe('REPARENT_RESULT', () => {
    it('returns true on successful reparent', () => {
      const payload = { success: true, entityId: 'entity-1' };

      const result = handleTransformEvent(
        'REPARENT_RESULT',
        payload,
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(true);
    });

    it('logs error on failed reparent', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const payload = {
        success: false,
        entityId: 'entity-1',
        error: 'Circular dependency detected',
      };

      const result = handleTransformEvent(
        'REPARENT_RESULT',
        payload,
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(true);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to reparent entity entity-1: Circular dependency detected'
      );

      consoleErrorSpy.mockRestore();
    });
  });

  describe('ENGINE_MODE_CHANGED', () => {
    it('sets engineMode to play via setState', () => {
      const payload = { mode: 'play' };

      const result = handleTransformEvent(
        'ENGINE_MODE_CHANGED',
        payload,
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(true);
      expect(useEditorStore.setState).toHaveBeenCalledWith({ engineMode: 'play' });
    });

    it('sets engineMode to edit via setState', () => {
      const payload = { mode: 'edit' };

      const result = handleTransformEvent(
        'ENGINE_MODE_CHANGED',
        payload,
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(true);
      expect(useEditorStore.setState).toHaveBeenCalledWith({ engineMode: 'edit' });
    });

    it('sets engineMode to paused via setState', () => {
      const payload = { mode: 'paused' };

      const result = handleTransformEvent(
        'ENGINE_MODE_CHANGED',
        payload,
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(true);
      expect(useEditorStore.setState).toHaveBeenCalledWith({ engineMode: 'paused' });
    });
  });

  describe('SCENE_EXPORTED', () => {
    it('dispatches forge:scene-exported DOM event', () => {
      const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
      vi.mocked(useEditorStore.getState).mockReturnValue({ ...actions, autoSaveEnabled: false } as unknown as StoreState);

      const payload = { json: '{"entities":[]}', name: 'MyScene' };

      const result = handleTransformEvent(
        'SCENE_EXPORTED',
        payload,
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(true);
      expect(dispatchSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'forge:scene-exported',
          detail: { json: '{"entities":[]}', name: 'MyScene' },
        })
      );

      dispatchSpy.mockRestore();
    });


    it('resets sceneModified to false after export', () => {
      vi.mocked(useEditorStore.getState).mockReturnValue({ ...actions, autoSaveEnabled: false } as unknown as StoreState);

      const payload = { json: '{"entities":[]}', name: 'MyScene' };

      handleTransformEvent(
        'SCENE_EXPORTED',
        payload,
        mockSetGet.set,
        mockSetGet.get
      );

      expect(useEditorStore.setState).toHaveBeenCalledWith({ sceneModified: false });
    });

    it('saves to localStorage when autoSaveEnabled is true', () => {
      vi.mocked(useEditorStore.getState).mockReturnValue({ ...actions, autoSaveEnabled: true } as unknown as StoreState);
      const mockSetItem = vi.fn();
      const origLocalStorage = globalThis.localStorage;
      Object.defineProperty(globalThis, 'localStorage', {
        value: { ...origLocalStorage, setItem: mockSetItem, getItem: vi.fn(), removeItem: vi.fn() },
        writable: true,
        configurable: true,
      });

      const payload = { json: '{"entities":[]}', name: 'TestScene' };

      const result = handleTransformEvent(
        'SCENE_EXPORTED',
        payload,
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(true);
      expect(mockSetItem).toHaveBeenCalledWith('forge:autosave', '{"entities":[]}');
      expect(mockSetItem).toHaveBeenCalledWith('forge:autosave:name', 'TestScene');
      expect(mockSetItem).toHaveBeenCalledWith('forge:autosave:time', expect.any(String));

      Object.defineProperty(globalThis, 'localStorage', {
        value: origLocalStorage,
        writable: true,
        configurable: true,
      });
    });

    it('handles localStorage quota exceeded gracefully', () => {
      vi.mocked(useEditorStore.getState).mockReturnValue({ ...actions, autoSaveEnabled: true } as unknown as StoreState);
      const origLocalStorage = globalThis.localStorage;
      Object.defineProperty(globalThis, 'localStorage', {
        value: {
          ...origLocalStorage,
          setItem: () => { throw new Error('QuotaExceededError'); },
          getItem: vi.fn(),
          removeItem: vi.fn(),
        },
        writable: true,
        configurable: true,
      });
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const payload = { json: '{"entities":[]}', name: 'BigScene' };

      const result = handleTransformEvent(
        'SCENE_EXPORTED',
        payload,
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(true);
      expect(warnSpy).toHaveBeenCalledWith(
        '[AutoSave] localStorage write failed after eviction attempt.'
      );

      warnSpy.mockRestore();
      Object.defineProperty(globalThis, 'localStorage', {
        value: origLocalStorage,
        writable: true,
        configurable: true,
      });
    });

    it('does not save to localStorage when autoSaveEnabled is false', () => {
      vi.mocked(useEditorStore.getState).mockReturnValue({ ...actions, autoSaveEnabled: false } as unknown as StoreState);
      const mockSetItem = vi.fn();
      const origLocalStorage = globalThis.localStorage;
      Object.defineProperty(globalThis, 'localStorage', {
        value: { ...origLocalStorage, setItem: mockSetItem, getItem: vi.fn(), removeItem: vi.fn() },
        writable: true,
        configurable: true,
      });

      const payload = { json: '{"entities":[]}', name: 'TestScene' };

      handleTransformEvent(
        'SCENE_EXPORTED',
        payload,
        mockSetGet.set,
        mockSetGet.get
      );

      expect(mockSetItem).not.toHaveBeenCalled();

      Object.defineProperty(globalThis, 'localStorage', {
        value: origLocalStorage,
        writable: true,
        configurable: true,
      });
    });
  });

  describe('SCENE_LOADED', () => {
    it('resets scene state via setState', () => {
      const payload = { name: 'LoadedScene' };

      const result = handleTransformEvent(
        'SCENE_LOADED',
        payload,
        mockSetGet.set,
        mockSetGet.get
      );

      expect(result).toBe(true);
      expect(useEditorStore.setState).toHaveBeenCalledWith({
        sceneName: 'LoadedScene',
        sceneModified: false,
        primaryMaterial: null,
        primaryLight: null,
        primaryPhysics: null,
        physicsEnabled: false,
        primaryAnimation: null,
      });
    });
  });
});
