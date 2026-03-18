import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createSliceStore, createMockDispatch } from './sliceTestTemplate';
import { createSceneSlice, setSceneDispatcher, type SceneSlice } from '../sceneSlice';

describe('sceneSlice', () => {
  let store: ReturnType<typeof createSliceStore<SceneSlice>>;
  let mockDispatch: ReturnType<typeof createMockDispatch>;

  beforeEach(() => {
    mockDispatch = createMockDispatch();
    setSceneDispatcher(mockDispatch);
    store = createSliceStore(createSceneSlice);
  });

  afterEach(() => {
    setSceneDispatcher(null as unknown as (command: string, payload: unknown) => void);
  });

  describe('Initial state', () => {
    it('should have default scene state', () => {
      expect(store.getState().sceneName).toBe('Untitled');
      expect(store.getState().sceneModified).toBe(false);
      expect(store.getState().autoSaveEnabled).toBe(true);
      expect(store.getState().scenes).toEqual([]);
      expect(store.getState().activeSceneId).toBeNull();
      expect(store.getState().sceneSwitching).toBe(false);
      expect(store.getState().sceneTransition).toEqual({ active: false, config: null, targetScene: null });
      expect(store.getState().terrainData).toEqual({});
      expect(store.getState().isExporting).toBe(false);
      expect(store.getState().projectId).toBeNull();
      expect(store.getState().cloudSaveStatus).toBe('idle');
      expect(store.getState().lastCloudSave).toBeNull();
    });

    it('should have default transition config', () => {
      expect(store.getState().defaultTransition).toEqual({
        type: 'fade',
        duration: 500,
        color: '#000000',
        easing: 'ease-in-out',
      });
    });
  });

  describe('saveScene / loadScene / newScene', () => {
    it('should dispatch export_scene', () => {
      store.getState().saveScene();
      expect(mockDispatch).toHaveBeenCalledWith('export_scene', {});
    });

    it('should dispatch load_scene with json', () => {
      store.getState().loadScene('{"entities":[]}');
      expect(mockDispatch).toHaveBeenCalledWith('load_scene', { json: '{"entities":[]}' });
    });

    it('should dispatch new_scene', () => {
      store.getState().newScene();
      expect(mockDispatch).toHaveBeenCalledWith('new_scene', {});
    });
  });

  describe('scene metadata setters', () => {
    it('should set scene name', () => {
      store.getState().setSceneName('My Scene');
      expect(store.getState().sceneName).toBe('My Scene');
    });

    it('should set scene modified', () => {
      store.getState().setSceneModified(true);
      expect(store.getState().sceneModified).toBe(true);
    });

    it('should set auto save', () => {
      store.getState().setAutoSaveEnabled(false);
      expect(store.getState().autoSaveEnabled).toBe(false);
    });
  });

  describe('multi-scene management', () => {
    it('should set scenes and active scene', () => {
      const scenes = [
        { id: 's1', name: 'Main', isStartScene: true },
        { id: 's2', name: 'Level2', isStartScene: false },
      ];
      store.getState().setScenes(scenes, 's1');

      expect(store.getState().scenes).toEqual(scenes);
      expect(store.getState().activeSceneId).toBe('s1');
    });

    it('should set scene switching flag', () => {
      store.getState().setSceneSwitching(true);
      expect(store.getState().sceneSwitching).toBe(true);
    });
  });

  describe('scene transitions', () => {
    it('should set default transition', () => {
      store.getState().setDefaultTransition({ type: 'wipe', duration: 1000 });

      expect(store.getState().defaultTransition.type).toBe('wipe');
      expect(store.getState().defaultTransition.duration).toBe(1000);
      expect(store.getState().defaultTransition.color).toBe('#000000'); // unchanged
    });

    it('startSceneTransition should reject unknown scenes', async () => {
      await store.getState().startSceneTransition('nonexistent');
      expect(store.getState().sceneTransition.active).toBe(false);
    });

    it('startSceneTransition should activate and deactivate', async () => {
      // Need to set up scenes first
      store.getState().setScenes([{ id: 's1', name: 'Level1', isStartScene: true }], 's1');
      store.getState().setDefaultTransition({ duration: 10 }); // fast for tests

      const promise = store.getState().startSceneTransition('Level1');

      // Should be active during transition
      expect(store.getState().sceneTransition.active).toBe(true);
      expect(store.getState().sceneTransition.targetScene).toBe('Level1');

      await promise;

      // Should be inactive after transition
      expect(store.getState().sceneTransition.active).toBe(false);
      expect(store.getState().sceneTransition.targetScene).toBeNull();
    });

    it('startSceneTransition should use config override', async () => {
      store.getState().setScenes([{ id: 's1', name: 'Main', isStartScene: true }], 's1');

      const promise = store.getState().startSceneTransition('Main', { type: 'wipe', duration: 10 });
      expect(store.getState().sceneTransition.config?.type).toBe('wipe');
      await promise;
    });
  });

  describe('terrain', () => {
    it('should dispatch spawn_terrain', () => {
      store.getState().spawnTerrain({ resolution: 256 } as never);
      expect(mockDispatch).toHaveBeenCalledWith('spawn_terrain', { resolution: 256 });
    });

    it('should dispatch spawn_terrain with empty params', () => {
      store.getState().spawnTerrain();
      expect(mockDispatch).toHaveBeenCalledWith('spawn_terrain', {});
    });

    it('should dispatch update_terrain', () => {
      store.getState().updateTerrain('terr-1', { resolution: 512 } as never);
      expect(mockDispatch).toHaveBeenCalledWith('update_terrain', { entityId: 'terr-1', resolution: 512 });
    });

    it('should dispatch sculpt_terrain', () => {
      store.getState().sculptTerrain('terr-1', [10, 20], 5, 0.5);
      expect(mockDispatch).toHaveBeenCalledWith('sculpt_terrain', {
        entityId: 'terr-1',
        position: [10, 20],
        radius: 5,
        strength: 0.5,
      });
    });

    it('should set terrain data for entity', () => {
      const data = { resolution: 256, heightmap: 'data' };
      store.getState().setTerrainData('terr-1', data as never);
      expect(store.getState().terrainData['terr-1']).toEqual(data);
    });
  });

  describe('CSG operations', () => {
    it('should dispatch csg_union', () => {
      store.getState().csgUnion('a', 'b', true);
      expect(mockDispatch).toHaveBeenCalledWith('csg_union', { entityIdA: 'a', entityIdB: 'b', deleteSources: true });
    });

    it('should dispatch csg_subtract', () => {
      store.getState().csgSubtract('a', 'b', false);
      expect(mockDispatch).toHaveBeenCalledWith('csg_subtract', { entityIdA: 'a', entityIdB: 'b', deleteSources: false });
    });

    it('should dispatch csg_intersect', () => {
      store.getState().csgIntersect('a', 'b');
      expect(mockDispatch).toHaveBeenCalledWith('csg_intersect', { entityIdA: 'a', entityIdB: 'b', deleteSources: undefined });
    });
  });

  describe('procedural modeling', () => {
    it('should dispatch extrude_shape', () => {
      store.getState().extrudeShape('circle', { depth: 2, segments: 16 });
      expect(mockDispatch).toHaveBeenCalledWith('extrude_shape', { shape: 'circle', depth: 2, segments: 16 });
    });

    it('should dispatch lathe_shape', () => {
      const profile: [number, number][] = [[0, 0], [1, 1], [0, 2]];
      store.getState().latheShape(profile, { segments: 32 });
      expect(mockDispatch).toHaveBeenCalledWith('lathe_shape', { profile, segments: 32 });
    });

    it('should dispatch array_entity', () => {
      store.getState().arrayEntity('ent-1', { count: 5, spacing: [2, 0, 0] });
      expect(mockDispatch).toHaveBeenCalledWith('array_entity', { entityId: 'ent-1', count: 5, spacing: [2, 0, 0] });
    });

    it('should dispatch combine_meshes', () => {
      store.getState().combineMeshes(['a', 'b', 'c'], true, 'Combined');
      expect(mockDispatch).toHaveBeenCalledWith('combine_meshes', {
        entityIds: ['a', 'b', 'c'],
        deleteSources: true,
        name: 'Combined',
      });
    });
  });

  describe('export / cloud', () => {
    it('should set exporting flag', () => {
      store.getState().setExporting(true);
      expect(store.getState().isExporting).toBe(true);
    });

    it('should set project ID', () => {
      store.getState().setProjectId('proj-123');
      expect(store.getState().projectId).toBe('proj-123');
    });

    it('should clear project ID', () => {
      store.getState().setProjectId('proj-123');
      store.getState().setProjectId(null);
      expect(store.getState().projectId).toBeNull();
    });

    it('should set cloud save status', () => {
      store.getState().setCloudSaveStatus('saving');
      expect(store.getState().cloudSaveStatus).toBe('saving');
      store.getState().setCloudSaveStatus('saved');
      expect(store.getState().cloudSaveStatus).toBe('saved');
    });
  });
});
