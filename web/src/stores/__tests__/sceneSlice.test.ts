/**
 * Unit tests for the sceneSlice — scene management, terrain, CSG, export, cloud.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createSceneSlice, setSceneDispatcher, type SceneSlice } from '../slices/sceneSlice';

function createTestStore() {
  const store = { state: {} as SceneSlice };
  const set = (partial: Partial<SceneSlice> | ((s: SceneSlice) => Partial<SceneSlice>)) => {
    if (typeof partial === 'function') Object.assign(store.state, partial(store.state));
    else Object.assign(store.state, partial);
  };
  const get = () => store.state;
  store.state = createSceneSlice(set as never, get as never, {} as never);
  return { getState: () => store.state };
}

describe('sceneSlice', () => {
  let store: ReturnType<typeof createTestStore>;
  let mockDispatch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockDispatch = vi.fn();
    setSceneDispatcher(mockDispatch as (command: string, payload: unknown) => void);
    store = createTestStore();
  });

  describe('Initial state', () => {
    it('should have default scene name', () => {
      expect(store.getState().sceneName).toBe('Untitled');
    });

    it('should not be modified', () => {
      expect(store.getState().sceneModified).toBe(false);
    });

    it('should have auto-save enabled', () => {
      expect(store.getState().autoSaveEnabled).toBe(true);
    });

    it('should have empty scenes list', () => {
      expect(store.getState().scenes).toEqual([]);
      expect(store.getState().activeSceneId).toBeNull();
    });

    it('should have default transition config', () => {
      expect(store.getState().defaultTransition.type).toBe('fade');
      expect(store.getState().defaultTransition.duration).toBe(500);
    });

    it('should not be exporting', () => {
      expect(store.getState().isExporting).toBe(false);
    });

    it('should have idle cloud status', () => {
      expect(store.getState().cloudSaveStatus).toBe('idle');
    });
  });

  describe('Scene file commands', () => {
    it('saveScene dispatches', () => {
      store.getState().saveScene();
      expect(mockDispatch).toHaveBeenCalledWith('save_scene', {});
    });

    it('loadScene dispatches with json', () => {
      store.getState().loadScene('{"entities":[]}');
      expect(mockDispatch).toHaveBeenCalledWith('load_scene', { json: '{"entities":[]}' });
    });

    it('newScene dispatches', () => {
      store.getState().newScene();
      expect(mockDispatch).toHaveBeenCalledWith('new_scene', {});
    });
  });

  describe('Scene metadata', () => {
    it('setSceneName updates state', () => {
      store.getState().setSceneName('Level 1');
      expect(store.getState().sceneName).toBe('Level 1');
    });

    it('setSceneModified updates state', () => {
      store.getState().setSceneModified(true);
      expect(store.getState().sceneModified).toBe(true);
    });

    it('setAutoSaveEnabled updates state', () => {
      store.getState().setAutoSaveEnabled(false);
      expect(store.getState().autoSaveEnabled).toBe(false);
    });
  });

  describe('Multi-scene', () => {
    it('setScenes updates list and active', () => {
      const scenes = [
        { id: 's1', name: 'Main', isStartScene: true },
        { id: 's2', name: 'Boss', isStartScene: false },
      ];
      store.getState().setScenes(scenes, 's1');
      expect(store.getState().scenes).toEqual(scenes);
      expect(store.getState().activeSceneId).toBe('s1');
    });

    it('setSceneSwitching updates flag', () => {
      store.getState().setSceneSwitching(true);
      expect(store.getState().sceneSwitching).toBe(true);
    });
  });

  describe('Scene transitions', () => {
    it('setDefaultTransition merges config', () => {
      store.getState().setDefaultTransition({ duration: 1000 });
      expect(store.getState().defaultTransition.duration).toBe(1000);
      expect(store.getState().defaultTransition.type).toBe('fade'); // unchanged
    });

    it('startSceneTransition does nothing for unknown scene', async () => {
      store.getState().setScenes([{ id: 's1', name: 'Main', isStartScene: true }], 's1');
      await store.getState().startSceneTransition('NonExistent');
      expect(store.getState().sceneTransition.active).toBe(false);
    });
  });

  describe('Terrain commands', () => {
    it('spawnTerrain dispatches', () => {
      store.getState().spawnTerrain({ seed: 42 } as never);
      expect(mockDispatch).toHaveBeenCalledWith('spawn_terrain', { seed: 42 });
    });

    it('updateTerrain dispatches with entityId', () => {
      store.getState().updateTerrain('ent-1', { seed: 10 } as never);
      expect(mockDispatch).toHaveBeenCalledWith('update_terrain', { entityId: 'ent-1', seed: 10 });
    });

    it('sculptTerrain dispatches', () => {
      store.getState().sculptTerrain('ent-1', [5, 5], 3, 0.5);
      expect(mockDispatch).toHaveBeenCalledWith('sculpt_terrain', { entityId: 'ent-1', position: [5, 5], radius: 3, strength: 0.5 });
    });

    it('setTerrainData sets local state', () => {
      const data = { seed: 99 } as never;
      store.getState().setTerrainData('ent-1', data);
      expect(store.getState().terrainData['ent-1']).toEqual(data);
      expect(mockDispatch).not.toHaveBeenCalled();
    });
  });

  describe('CSG operations', () => {
    it('csgUnion dispatches', () => {
      store.getState().csgUnion('a', 'b', true);
      expect(mockDispatch).toHaveBeenCalledWith('csg_union', { entityIdA: 'a', entityIdB: 'b', deleteSources: true });
    });

    it('csgSubtract dispatches', () => {
      store.getState().csgSubtract('a', 'b', false);
      expect(mockDispatch).toHaveBeenCalledWith('csg_subtract', { entityIdA: 'a', entityIdB: 'b', deleteSources: false });
    });

    it('csgIntersect dispatches', () => {
      store.getState().csgIntersect('a', 'b');
      expect(mockDispatch).toHaveBeenCalledWith('csg_intersect', { entityIdA: 'a', entityIdB: 'b', deleteSources: undefined });
    });
  });

  describe('Procedural operations', () => {
    it('extrudeShape dispatches', () => {
      store.getState().extrudeShape('circle', { height: 5 });
      expect(mockDispatch).toHaveBeenCalledWith('extrude_shape', { shape: 'circle', height: 5 });
    });

    it('latheShape dispatches', () => {
      const profile: [number, number][] = [[0, 0], [1, 1]];
      store.getState().latheShape(profile, { segments: 16 });
      expect(mockDispatch).toHaveBeenCalledWith('lathe_shape', { profile, segments: 16 });
    });

    it('arrayEntity dispatches', () => {
      store.getState().arrayEntity('ent-1', { count: 5, offset: [1, 0, 0] });
      expect(mockDispatch).toHaveBeenCalledWith('array_entity', { entityId: 'ent-1', count: 5, offset: [1, 0, 0] });
    });

    it('combineMeshes dispatches', () => {
      store.getState().combineMeshes(['a', 'b'], true, 'Combined');
      expect(mockDispatch).toHaveBeenCalledWith('combine_meshes', { entityIds: ['a', 'b'], deleteSources: true, name: 'Combined' });
    });
  });

  describe('Export & cloud', () => {
    it('setExporting updates flag', () => {
      store.getState().setExporting(true);
      expect(store.getState().isExporting).toBe(true);
    });

    it('setProjectId updates state', () => {
      store.getState().setProjectId('proj-123');
      expect(store.getState().projectId).toBe('proj-123');
    });

    it('setCloudSaveStatus updates state', () => {
      store.getState().setCloudSaveStatus('saving');
      expect(store.getState().cloudSaveStatus).toBe('saving');
    });
  });

  describe('Dispatcher not set', () => {
    it('does not throw when dispatcher is null', () => {
      setSceneDispatcher(null as never);
      store = createTestStore();
      expect(() => store.getState().saveScene()).not.toThrow();
      expect(() => store.getState().spawnTerrain()).not.toThrow();
      expect(() => store.getState().csgUnion('a', 'b')).not.toThrow();
    });
  });
});
