import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createMockDispatch } from './sliceTestTemplate';
import { createSceneTestStore } from './sceneSliceTestStore';
import { setSceneDispatcher } from '../sceneSlice';
import { loadProjectScenes } from '@/lib/scenes/sceneManager';
import { sceneFixture } from '@/lib/scenes/__tests__/sceneFixture';
import { takeStagedSceneAudio, clearStagedSceneAudio } from '@/lib/audio/sceneAudioManifest';
import { useMusicArrangementStore } from '@/lib/music/arrangementStore';
import { loadPrefabInstances, savePrefabInstancesToStorage, savePrefab, getPrefab } from '@/lib/prefabs/prefabStore';
import * as prefabStoreModule from '@/lib/prefabs/prefabStore';

describe('sceneSlice', () => {
  let store: ReturnType<typeof createSceneTestStore>['store'];
  let mockDispatch: ReturnType<typeof createMockDispatch>;

  beforeEach(() => {
    mockDispatch = createMockDispatch();
    setSceneDispatcher(mockDispatch);
    store = createSceneTestStore().store;
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

    // #10058: newScene()/loadScene() used to leave whatever music arrangement
    // was in the store from the PREVIOUS scene — stale tracks/clips that then
    // rode along into the new scene's next cloud save.
    it('newScene clears a stale music arrangement left by the previous scene', () => {
      const trackId = useMusicArrangementStore.getState().addTrack('Stale');
      useMusicArrangementStore.getState().addClip({ trackId, sourceUrl: 'x', sourceDurationSeconds: 10 });
      expect(useMusicArrangementStore.getState().arrangement.tracks).toHaveLength(1);

      store.getState().newScene();

      expect(useMusicArrangementStore.getState().arrangement.tracks).toHaveLength(0);
      expect(useMusicArrangementStore.getState().arrangement.clips).toHaveLength(0);
    });

    it('loadScene clears a stale music arrangement when the loaded scene carries none', () => {
      useMusicArrangementStore.getState().addTrack('Stale');
      expect(useMusicArrangementStore.getState().arrangement.tracks).toHaveLength(1);

      store.getState().loadScene('{"entities":[]}');

      expect(useMusicArrangementStore.getState().arrangement.tracks).toHaveLength(0);
    });

    it('loadScene restores the loaded scene\'s own music arrangement instead of the stale one', () => {
      useMusicArrangementStore.getState().addTrack('Stale');

      store.getState().loadScene(JSON.stringify({
        entities: [],
        musicArrangement: {
          version: 1,
          tracks: [{ id: 'track_new', name: 'From loaded scene', muted: false }],
          clips: [],
          tempoBpm: 120,
        },
      }));

      const tracks = useMusicArrangementStore.getState().arrangement.tracks;
      expect(tracks).toHaveLength(1);
      expect(tracks[0].name).toBe('From loaded scene');
    });

    it('loadScene rejects malformed json before touching the music arrangement', () => {
      // Malformed JSON is now caught by `restorePrefabInstances`'s own parse
      // BEFORE `dispatchSceneLoad` ever runs (#10056), so the load is rejected
      // outright and the scene on screen — and its arrangement — is unchanged.
      // `syncArrangementFromLoadedScene` never runs on a rejected load.
      useMusicArrangementStore.getState().hydrate(null); // known starting state
      useMusicArrangementStore.getState().addTrack('Live');

      let accepted: boolean | undefined;
      expect(() => { accepted = store.getState().loadScene('not valid json'); }).not.toThrow();

      expect(accepted).toBe(false);
      expect(useMusicArrangementStore.getState().arrangement.tracks).toHaveLength(1);
      expect(useMusicArrangementStore.getState().arrangement.tracks[0].name).toBe('Live');
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

    it('drops the stash when the engine refuses the load outright', () => {
      // Same reasoning as new_scene: a refused load never emits SCENE_LOADED,
      // so the stash would sit armed and be claimed by the next scene that does.
      clearStagedSceneAudio();
      setSceneDispatcher(vi.fn(() => ({ success: false, error: 'Scene JSON too large' })));

      store.getState().loadScene(
        JSON.stringify({ entities: [{ entityId: 'e1', audioData: { assetId: 'a1' } }] })
      );

      expect(takeStagedSceneAudio()).toEqual({});
    });

    it('stages nothing when there is no dispatcher to load the scene', () => {
      // No dispatcher means the engine never loads and never emits
      // SCENE_LOADED, so a stash written here would wait until some LATER
      // scene's SCENE_LOADED claimed it — attaching this scene's sounds to a
      // different scene's entity ids.
      clearStagedSceneAudio();
      setSceneDispatcher(null as unknown as (command: string, payload: unknown) => void);

      store.getState().loadScene(
        JSON.stringify({ entities: [{ entityId: 'e1', audioData: { assetId: 'a1' } }] })
      );

      expect(takeStagedSceneAudio()).toEqual({});
    });
  });

  // scene.FR-1 N1 BUG-1/BUG-2: the prefab-instance registry must mirror the
  // ACTIVE scene, not silently carry the outgoing scene's instances forward.
  describe('newScene / loadScene keep the prefab-instance registry in sync', () => {
    it('newScene clears the registry so a fresh save does not attach old instances', () => {
      savePrefabInstancesToStorage([{ instanceId: 'pfi_1', prefabId: 'src', overrides: {} }]);
      store.getState().newScene();
      expect(loadPrefabInstances()).toEqual([]);
    });

    it('loadScene installs the incoming scene\'s registry', () => {
      savePrefabInstancesToStorage([{ instanceId: 'pfi_old', prefabId: 'old', overrides: {} }]);
      store.getState().loadScene(
        JSON.stringify({
          entities: [],
          prefabInstances: [{ instanceId: 'pfi_new', prefabId: 'new', overrides: {} }],
          prefabDefinitions: [{
            id: 'new', name: 'New', category: 'test', description: '',
            snapshot: { entityType: 'cube', name: 'New', transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
          }],
        })
      );
      expect(loadPrefabInstances()).toEqual([{ instanceId: 'pfi_new', prefabId: 'new', overrides: {} }]);
    });

    it('restores the PREVIOUS registry when the engine rejects the load', () => {
      // A rejected dispatch never emits SCENE_LOADED — the scene on screen is
      // still the previous one, so its registry must come back rather than
      // stay overwritten by the rejected scene's (scene.FR-1 N1 BUG-2): a
      // later save would otherwise persist the wrong instances onto the scene
      // that is actually still active.
      const previous = [{ instanceId: 'pfi_prev', prefabId: 'prev', overrides: {} }];
      savePrefabInstancesToStorage(previous);
      setSceneDispatcher(vi.fn(() => ({ success: false, error: 'Scene JSON too large' })));

      store.getState().loadScene(
        JSON.stringify({ entities: [], prefabInstances: [{ instanceId: 'pfi_bad', prefabId: 'bad', overrides: {} }] })
      );

      expect(loadPrefabInstances()).toEqual(previous);
    });

    it('merges a scene\'s embedded prefab definitions into the local library on load', () => {
      expect(getPrefab('prefab_embedded')).toBeUndefined();
      store.getState().loadScene(
        JSON.stringify({
          entities: [],
          prefabInstances: [{ instanceId: 'pfi_1', prefabId: 'prefab_embedded', overrides: {} }],
          prefabDefinitions: [{
            id: 'prefab_embedded', name: 'Embedded', category: 'cat', description: '',
            snapshot: { entityType: 'cube', name: 'Embedded', transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
            createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
          }],
        })
      );
      expect(getPrefab('prefab_embedded')?.name).toBe('Embedded');
    });

    it('drops a single malformed embedded definition rather than rejecting the whole scene load', () => {
      // Routed through `readPrefabDefinitions`, an individual malformed or
      // oversized entry is dropped (fail-soft) instead of one bad definition
      // rejecting the ENTIRE scene load — which is what passing the raw array
      // straight to `mergeImportedPrefabDefinitions` did.
      expect(getPrefab('prefab_ok')).toBeUndefined();
      const loaded = store.getState().loadScene(
        JSON.stringify({
          entities: [],
          prefabInstances: [{ instanceId: 'pfi_ok', prefabId: 'prefab_ok', overrides: {} }],
          prefabDefinitions: [
            {
              id: 'prefab_ok', name: 'Ok', category: 'cat', description: '',
              snapshot: { entityType: 'cube', name: 'Ok', transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
            },
            // Structurally invalid — no `snapshot`; `sanitizePrefabDefinition`
            // rejects it, so `readPrefabDefinitions` drops it before the merge.
            { id: 'prefab_bad', name: 'Bad', category: 'cat', description: '' },
          ],
        })
      );
      expect(loaded).toBe(true);
      expect(getPrefab('prefab_ok')?.name).toBe('Ok');
      expect(getPrefab('prefab_bad')).toBeUndefined();
      // The valid instance survives; nothing dangled it out.
      expect(loadPrefabInstances()).toEqual([{ instanceId: 'pfi_ok', prefabId: 'prefab_ok', overrides: {} }]);
    });

    it('never overwrites a local prefab definition with an embedded one of the same id', () => {
      const local = savePrefab('LocalName', 'cat', '', {
        entityType: 'cube', name: 'LocalName', transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      });
      store.getState().loadScene(
        JSON.stringify({
          entities: [],
          prefabDefinitions: [{ ...local, name: 'RemoteStaleCopy' }],
        })
      );
      expect(getPrefab(local.id)?.name).toBe('LocalName');
    });

    it('rolls back an embedded definition too when the engine rejects the load', () => {
      // `mergeImportedPrefabDefinitions` is not itself part of the rejected
      // dispatch — without rolling it back, a rejected scene's definitions
      // would install into the library permanently even though the engine
      // never actually loaded that scene (scene.FR-1 N1 BUG-5).
      expect(getPrefab('prefab_rejected')).toBeUndefined();
      setSceneDispatcher(vi.fn(() => ({ success: false, error: 'Scene JSON too large' })));

      store.getState().loadScene(
        JSON.stringify({
          entities: [],
          prefabDefinitions: [{
            id: 'prefab_rejected', name: 'Rejected', category: 'cat', description: '',
            snapshot: { entityType: 'cube', name: 'Rejected', transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
            createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
          }],
        })
      );

      expect(getPrefab('prefab_rejected')).toBeUndefined();
    });

    it('rejects invalid dependency graphs before dispatch without replacing existing prefab state', () => {
      const previous = [{ instanceId: 'old-link', prefabId: 'old-source', overrides: { name: 'Kept' } }];
      savePrefabInstancesToStorage(previous);
      const dispatcher = vi.fn();
      setSceneDispatcher(dispatcher);
      const definition = {
        id: 'cycle', name: 'Cycle', category: 'test', description: '',
        snapshot: { entityType: 'cube', name: 'Cycle', transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
        children: [{ instanceId: 'edge', prefabId: 'cycle' }],
      };
      expect(store.getState().loadScene(JSON.stringify({ entities: [], prefabDefinitions: [definition] }))).toBe(false);
      expect(dispatcher).not.toHaveBeenCalled();
      expect(loadPrefabInstances()).toEqual(previous);
      expect(getPrefab('cycle')).toBeUndefined();
    });

    it('newScene restores the PREVIOUS registry when the engine rejects new_scene', () => {
      // scene.FR-1 N1 BUG-4: `new_scene` can fail too (e.g. the engine's
      // PendingCommands resource is not yet initialized) — a failed dispatch
      // must not still clear the registry describing the UNCHANGED scene.
      const previous = [{ instanceId: 'pfi_prev', prefabId: 'prev', overrides: {} }];
      savePrefabInstancesToStorage(previous);
      setSceneDispatcher(vi.fn(() => ({ success: false, error: 'PendingCommands resource not initialized' })));

      store.getState().newScene();

      expect(loadPrefabInstances()).toEqual(previous);
    });

    it('newScene leaves the registry untouched when there is no dispatcher at all', () => {
      // No engine means the scene never actually changed — clearing here would
      // describe a scene that is still showing its old instances.
      const previous = [{ instanceId: 'pfi_prev', prefabId: 'prev', overrides: {} }];
      savePrefabInstancesToStorage(previous);
      setSceneDispatcher(null as unknown as (command: string, payload: unknown) => void);

      store.getState().newScene();

      expect(loadPrefabInstances()).toEqual(previous);
    });
  });

  /**
   * #10056. `loadScene` gained rejection paths that return WITHOUT dispatching,
   * and the editor page discards its boolean — so a rejected scene left an empty
   * viewport with the project's name on it, and the next save wrote that empty
   * scene over the project's stored `sceneData`.
   *
   * The boolean alone cannot fix it: it is also false on a healthy cold open
   * (the engine dispatcher mounts after the editor page), so gating the UI on it
   * would error on every working open. `sceneLoadError` is the field that
   * separates REJECTION from DEFERRAL, which is what the first tests pin.
   */
  describe('sceneLoadError (#10056)', () => {
    /** A definition whose only child edge points back at itself — a cycle. */
    const cyclicDefinition = {
      id: 'cycle', name: 'Cycle', category: 'test', description: '',
      snapshot: { entityType: 'cube', name: 'Cycle', transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
      children: [{ instanceId: 'edge', prefabId: 'cycle' }],
    };
    const cyclicScene = JSON.stringify({ entities: [], prefabDefinitions: [cyclicDefinition] });
    // A definition dropped by `readPrefabDefinitions` for exceeding the 256 KiB
    // cap (SEC bound), nested by a second, otherwise-valid definition. The drop
    // is fail-SOFT on its own, but leaves `parentDefinition.children` pointing
    // at an id the merge no longer has — a dangling reference the graph-level
    // check in `prepareImportedDefinitions` fail-HARD rejects.
    const oversizedDefinition = {
      id: 'oversized_child', name: 'Oversized', category: 'test', description: 'x'.repeat(300 * 1024),
      snapshot: { entityType: 'cube', name: 'Oversized', transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
    };
    const parentDefinition = {
      id: 'parent', name: 'Parent', category: 'test', description: '',
      snapshot: { entityType: 'cube', name: 'Parent', transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
      children: [{ instanceId: 'edge', prefabId: 'oversized_child' }],
    };
    const danglingReferenceScene = JSON.stringify({
      entities: [], prefabDefinitions: [oversizedDefinition, parentDefinition],
    });
    const healthyScene = JSON.stringify({ entities: [] });

    it('starts null', () => {
      expect(store.getState().sceneLoadError).toBeNull();
    });

    it('records a reason and dispatches nothing when the embedded prefab graph is invalid', () => {
      const dispatcher = vi.fn();
      setSceneDispatcher(dispatcher);

      expect(store.getState().loadScene(cyclicScene)).toBe(false);

      expect(dispatcher).not.toHaveBeenCalled();
      expect(store.getState().sceneLoadError).toEqual({
        reason: expect.stringContaining('could not be opened'),
        at: expect.any(Number),
      });
    });

    it('records a reason and dispatches nothing when a nested definition references one dropped for being oversized', () => {
      const dispatcher = vi.fn();
      setSceneDispatcher(dispatcher);

      expect(store.getState().loadScene(danglingReferenceScene)).toBe(false);

      expect(dispatcher).not.toHaveBeenCalled();
      expect(store.getState().sceneLoadError).toEqual({
        reason: expect.stringContaining('could not be opened'),
        at: expect.any(Number),
      });
    });

    // Sentry: a QuotaExceededError (or any other storage failure) from the
    // rollback write itself used to propagate uncaught out of `loadScene`,
    // replacing the diagnosed rejection above with an unhandled exception.
    it('does not throw when the rollback write itself fails (Sentry)', () => {
      const dispatcher = vi.fn();
      setSceneDispatcher(dispatcher);
      const spy = vi.spyOn(prefabStoreModule, 'savePrefabInstancesToStorage').mockImplementation(() => {
        throw new DOMException('Quota exceeded', 'QuotaExceededError');
      });

      try {
        expect(() => store.getState().loadScene(cyclicScene)).not.toThrow();
        expect(store.getState().loadScene(cyclicScene)).toBe(false);
      } finally {
        spy.mockRestore();
      }
    });

    it('records a reason when the engine itself rejects the load', () => {
      setSceneDispatcher(vi.fn(() => ({ success: false, error: 'Scene JSON too large' })));

      expect(store.getState().loadScene(healthyScene)).toBe(false);

      expect(store.getState().sceneLoadError?.reason).toContain('the engine refused');
    });

    it('leaves sceneLoadError null with no dispatcher, because a deferred load is not an error', () => {
      // THE regression this field exists for: the editor page calls `loadScene`
      // before `EditorLayout` mounts the engine, so every healthy cold open
      // takes this branch and returns false. Treating that as a rejection would
      // put an error banner on a working editor and block all of its saves.
      setSceneDispatcher(null as unknown as (command: string, payload: unknown) => void);

      expect(store.getState().loadScene(healthyScene)).toBe(false);

      expect(store.getState().sceneLoadError).toBeNull();
    });

    it('clears sceneLoadError once a scene loads successfully', () => {
      setSceneDispatcher(vi.fn(() => ({ success: false, error: 'Scene JSON too large' })));
      store.getState().loadScene(healthyScene);
      expect(store.getState().sceneLoadError).not.toBeNull();

      setSceneDispatcher(createMockDispatch());
      expect(store.getState().loadScene(healthyScene)).toBe(true);

      expect(store.getState().sceneLoadError).toBeNull();
    });

    it('clears sceneLoadError when the user starts a new scene', () => {
      // A deliberately empty scene IS trustworthy, so `newScene` is a way back
      // out of the save lockout rather than a dead end.
      store.getState().loadScene(cyclicScene);
      expect(store.getState().sceneLoadError).not.toBeNull();

      expect(store.getState().newScene()).toBe(true);

      expect(store.getState().sceneLoadError).toBeNull();
    });

    it('keeps sceneLoadError set when the engine also rejects the new scene', () => {
      store.getState().loadScene(cyclicScene);
      setSceneDispatcher(vi.fn(() => ({ success: false, error: 'PendingCommands resource not initialized' })));

      expect(store.getState().newScene()).toBe(false);

      // The untrustworthy scene is still on screen, so the lockout must stand.
      expect(store.getState().sceneLoadError).not.toBeNull();
    });

    it('refuses to export the engine scene while a load stands rejected', () => {
      // The data guard. Every persistence consumer downstream of SCENE_EXPORTED
      // (localStorage autosave, the IndexedDB cache, the sessionStorage panic
      // backup, the cloud PUT) writes whatever JSON comes back, so not ASKING is
      // what keeps the engine's empty scene off the project's stored sceneData.
      store.getState().loadScene(cyclicScene);
      const dispatcher = createMockDispatch();
      setSceneDispatcher(dispatcher);

      store.getState().saveScene('req_1');
      store.getState().saveToCloud('req_2');

      expect(dispatcher).not.toHaveBeenCalledWith('export_scene', expect.anything());
    });

    it('exports again once the rejection clears', () => {
      store.getState().loadScene(cyclicScene);
      const dispatcher = createMockDispatch();
      setSceneDispatcher(dispatcher);
      store.getState().saveScene('req_blocked');
      expect(dispatcher).not.toHaveBeenCalledWith('export_scene', expect.anything());

      expect(store.getState().loadScene(healthyScene)).toBe(true);
      store.getState().saveScene('req_allowed');
      store.getState().saveToCloud('req_allowed_cloud');

      expect(dispatcher).toHaveBeenCalledWith('export_scene', { requestId: 'req_allowed' });
      expect(dispatcher).toHaveBeenCalledWith('export_scene', { requestId: 'req_allowed_cloud' });
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
      const detached = createSceneTestStore().store;

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
        if (command === 'validate_scene') return { success: true };
        if (command === 'export_scene') {
          window.dispatchEvent(
            new CustomEvent('forge:scene-exported', {
              detail: { json: JSON.stringify(sceneFixture('Live')) },
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

    // Sentry: `loadScene`/`newScene` roll back their OWN state before
    // rethrowing a dispatch error, but `switchScene` previously let that
    // exception propagate straight past its `saveProjectScenes` calls —
    // silently losing the outgoing scene's captured work, and surfacing as an
    // unhandled rejection at `SceneBrowser.tsx`'s bare `void switchScene(...)`.
    it('persists the outgoing scene when the engine dispatch throws instead of losing it (Sentry)', async () => {
      store.getState().createNewScene('Second');
      const before = store.getState().activeSceneId;
      const target = store.getState().scenes.find((s) => s.name === 'Second');

      setSceneDispatcher((command, payload) => {
        mockDispatch(command, payload);
        if (command === 'validate_scene') return { success: true };
        if (command === 'export_scene') {
          window.dispatchEvent(
            new CustomEvent('forge:scene-exported', {
              detail: { json: JSON.stringify(sceneFixture('Live')) },
            })
          );
        }
        if (command === 'load_scene') {
          throw new Error('engine unreachable');
        }
      });

      await expect(store.getState().switchScene(target!.id)).resolves.toBeUndefined();

      // The switch itself did not go through...
      expect(store.getState().activeSceneId).toBe(before);
      expect(persisted().activeSceneId).toBe(before);
      // ...but the outgoing scene's freshly captured data was NOT discarded.
      const outgoing = persisted().scenes.find((s) => s.id === before);
      expect(outgoing?.data?.metadata?.name).toBe('Live');
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
