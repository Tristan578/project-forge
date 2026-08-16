import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createSliceStore, createMockDispatch } from './sliceTestTemplate';
import { createSceneSlice, setSceneDispatcher, type SceneSlice } from '../sceneSlice';
import { loadProjectScenes } from '@/lib/scenes/sceneManager';
import { takeStagedSceneAudio, clearStagedSceneAudio } from '@/lib/audio/sceneAudioManifest';

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
      expect(store.getState().sceneTransition).toEqual({ active: false, config: null, targetScene: null, transitionId: null });
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

    it('stages the audio the scene declares, since SCENE_LOADED carries only a name', () => {
      clearStagedSceneAudio();
      store.getState().loadScene(
        JSON.stringify({ entities: [{ entityId: 'e1', audioData: { assetId: 'a1' } }] })
      );

      expect(takeStagedSceneAudio()).toMatchObject({
        e1: expect.objectContaining({ assetId: 'a1' }),
      });
    });

    it('drops a stash the engine never confirmed when a new scene starts', () => {
      // new_scene emits the same SCENE_LOADED a load does, so a rejected load's
      // stash would otherwise attach audio to an empty scene's dead ids.
      store.getState().loadScene(
        JSON.stringify({ entities: [{ entityId: 'e1', audioData: { assetId: 'a1' } }] })
      );
      store.getState().newScene();

      expect(takeStagedSceneAudio()).toEqual({});
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
    it('should dispatch spawn_terrain with the caller config plus a generated id', () => {
      const id = store.getState().spawnTerrain({ resolution: 256 } as never);
      expect(id).toEqual(expect.any(String));
      expect(mockDispatch).toHaveBeenCalledWith('spawn_terrain', { resolution: 256, id });
    });

    it('should dispatch spawn_terrain with empty params', () => {
      const id = store.getState().spawnTerrain();
      expect(mockDispatch).toHaveBeenCalledWith('spawn_terrain', { id });
    });

    // The whole point of generating the id client-side: the caller can target the
    // new terrain immediately. `primaryId` is only written by the async
    // SELECTION_CHANGED event, so anything that read it here saw null on a fresh
    // scene and silently dropped the terrain (#8749).
    it('should return the id it sent to the engine, synchronously', () => {
      const id = store.getState().spawnTerrain();
      const [, payload] = mockDispatch.mock.calls[0] as [string, { id: string }];
      expect(payload.id).toBe(id);
    });

    // The engine only honors a well-formed override id; a malformed one is
    // ignored and the entity gets a generated UUID instead, so the id we
    // returned would name nothing.
    it('should send a UUID the engine will accept as an override', () => {
      const id = store.getState().spawnTerrain();
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
    });

    it('should give each terrain its own id', () => {
      const first = store.getState().spawnTerrain();
      const second = store.getState().spawnTerrain();
      expect(first).not.toBe(second);
    });

    // Returning an id while nothing was dispatched would be a phantom reference
    // that every follow-up command targets in vain.
    it('should return undefined and dispatch nothing when the engine is not loaded', () => {
      setSceneDispatcher(null as unknown as (command: string, payload: unknown) => void);
      const detached = createSliceStore(createSceneSlice);

      expect(detached.getState().spawnTerrain()).toBeUndefined();
      expect(mockDispatch).not.toHaveBeenCalled();
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

    // PF-540: lastCloudSave must be settable so AutoSaveRecovery can compare timestamps
    it('should set lastCloudSave via setLastCloudSave', () => {
      const ts = '2026-01-15T12:00:00.000Z';
      store.getState().setLastCloudSave(ts);
      expect(store.getState().lastCloudSave).toBe(ts);
    });

    it('should update lastCloudSave to a newer timestamp', () => {
      const first = '2026-01-15T10:00:00.000Z';
      const second = '2026-01-15T12:00:00.000Z';
      store.getState().setLastCloudSave(first);
      store.getState().setLastCloudSave(second);
      expect(store.getState().lastCloudSave).toBe(second);
    });
  });

  describe('saveToCloud', () => {
    // PF-540: saveToCloud should trigger export_scene so SceneToolbar can PUT to the API
    it('dispatches export_scene when projectId-aware cloud save is triggered', () => {
      store.getState().saveToCloud();
      expect(mockDispatch).toHaveBeenCalledWith('export_scene', {});
    });
  });

  // PF-1097: these four actions dispatched engine commands that reject by design
  // (scene management is JS-side), so every Scene Browser control was inert.
  describe('Scene Browser actions', () => {
    beforeEach(() => {
      localStorage.clear();
      // PF-1100: switching and duplicating first read the live scene back out of
      // the engine (`export_scene` → `forge:scene-exported`) and REFUSE to
      // proceed if that answer never comes. The shared mock dispatcher records
      // commands without answering any, so it has to be wrapped here or every
      // async action below would sit out the full capture timeout and then
      // correctly decline to do anything.
      setSceneDispatcher((command, payload) => {
        mockDispatch(command, payload);
        if (command === 'export_scene') {
          window.dispatchEvent(
            new CustomEvent('forge:scene-exported', {
              detail: { json: '{"formatVersion":3,"sceneName":"Live","entities":[]}' },
            })
          );
        }
      });
    });

    function persisted() {
      return loadProjectScenes();
    }

    it('createNewScene records a scene and mirrors it into store state', () => {
      store.getState().createNewScene('Boss Room');

      expect(persisted().scenes.some((s) => s.name === 'Boss Room')).toBe(true);
      expect(store.getState().scenes.some((s) => s.name === 'Boss Room')).toBe(true);
    });

    it('createNewScene defaults the name when none is given', () => {
      store.getState().createNewScene();
      expect(store.getState().scenes.some((s) => s.name === 'New Scene')).toBe(true);
    });

    it('switchScene makes the target active and loads its data', async () => {
      store.getState().createNewScene('Second');
      const target = store.getState().scenes.find((s) => s.name === 'Second');

      await store.getState().switchScene(target!.id);

      expect(persisted().activeSceneId).toBe(target!.id);
      expect(store.getState().activeSceneId).toBe(target!.id);
      expect(mockDispatch).toHaveBeenCalledWith('load_scene', expect.anything());
    });

    it('switchScene leaves state untouched for an unknown scene', async () => {
      const before = store.getState().activeSceneId;
      await store.getState().switchScene('scene_does_not_exist');
      expect(store.getState().activeSceneId).toBe(before);
    });

    it('duplicateScene adds a copy', async () => {
      store.getState().createNewScene('Original');
      const source = store.getState().scenes.find((s) => s.name === 'Original');

      await store.getState().duplicateScene(source!.id);

      expect(store.getState().scenes.some((s) => s.name === 'Original Copy')).toBe(true);
      expect(persisted().scenes.some((s) => s.name === 'Original Copy')).toBe(true);
    });

    it('deleteScene removes a non-active scene', () => {
      store.getState().createNewScene('Doomed');
      const doomed = store.getState().scenes.find((s) => s.name === 'Doomed');

      store.getState().deleteScene(doomed!.id);

      expect(store.getState().scenes.some((s) => s.name === 'Doomed')).toBe(false);
      expect(persisted().scenes.some((s) => s.name === 'Doomed')).toBe(false);
    });

    it('deleteScene refuses to delete the active scene', () => {
      store.getState().createNewScene('Keeper');
      const activeId = persisted().activeSceneId;

      store.getState().deleteScene(activeId);

      expect(persisted().scenes.some((s) => s.id === activeId)).toBe(true);
    });

    it('never dispatches an unimplemented scene-management command', async () => {
      store.getState().createNewScene('A');
      const a = store.getState().scenes.find((s) => s.name === 'A');
      await store.getState().switchScene(a!.id);
      await store.getState().duplicateScene(a!.id);
      store.getState().createNewScene('B');
      const b = store.getState().scenes.find((s) => s.name === 'B');
      store.getState().deleteScene(b!.id);

      const dispatched = mockDispatch.mock.calls.map((c) => c[0]);
      for (const stub of ['create_scene', 'switch_scene', 'delete_scene', 'duplicate_scene', 'save_scene']) {
        expect(dispatched).not.toContain(stub);
      }
    });
  });
});
