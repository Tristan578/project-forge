// @vitest-environment jsdom
//
// PF-1100: `saveCurrentSceneData` had no production caller, so every scene's
// stored `data` stayed null for its whole life. Switching scenes therefore
// discarded the outgoing scene's work AND loaded nothing back — multi-scene
// projects behaved as though every scene were permanently empty.
//
// These live in their own file because they need a DOM: the capture is an
// `export_scene` → `forge:scene-exported` round trip, and `src/stores/**` runs
// under the node environment by default.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createSceneTestStore } from './sceneSliceTestStore';
import { setSceneDispatcher } from '../sceneSlice';
import { loadProjectScenes, saveProjectScenes, readPrefabInstances } from '@/lib/scenes/sceneManager';
import { SCENE_EXPORTED_EVENT, SCENE_CAPTURE_TIMEOUT_MS } from '@/lib/scenes/captureScene';
import {
  loadPrefabInstances,
  savePrefabsToStorage,
  savePrefabInstancesToStorage,
  type PrefabInstance,
} from '@/lib/prefabs/prefabStore';
import { sceneFixture } from '@/lib/scenes/__tests__/sceneFixture';

const LIVE_SCENE = {
  ...sceneFixture('Level 1'),
  entities: [{
    entityId: 'player', entityType: 'cube', name: 'Player', visible: true,
    transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    parentId: null, materialData: null, lightData: null, physicsData: null, physicsEnabled: false,
  }],
};

/** A dispatcher that answers `export_scene` the way the engine bridge does. */
function answeringDispatcher() {
  const calls: Array<{ command: string; payload: unknown }> = [];
  const dispatch = (command: string, payload: unknown) => {
    calls.push({ command, payload });
    if (command === 'validate_scene') return { success: true };
    if (command === 'export_scene') {
      window.dispatchEvent(
        new CustomEvent(SCENE_EXPORTED_EVENT, {
          detail: { json: JSON.stringify(LIVE_SCENE), name: LIVE_SCENE.metadata?.name },
        })
      );
    }
  };
  return { dispatch, calls };
}

describe('sceneSlice scene persistence', () => {
  let store: ReturnType<typeof createSceneTestStore>['store'];

  beforeEach(() => {
    localStorage.clear();
    // `loadProjectScenes()` mints a fresh throwaway project on every call until
    // something persists one, so the ids it hands back are only stable once the
    // initial project is written down. Seed it, or every assertion here would be
    // comparing against a scene that no later call has ever heard of.
    saveProjectScenes(loadProjectScenes());
    store = createSceneTestStore().store;
  });

  afterEach(() => {
    setSceneDispatcher(null as unknown as (command: string, payload: unknown) => void);
    vi.useRealTimers();
  });

  it('saves the live scene before switching away from it', async () => {
    const { dispatch } = answeringDispatcher();
    setSceneDispatcher(dispatch);

    const outgoingId = loadProjectScenes().activeSceneId;
    store.getState().createNewScene('Second');
    const target = store.getState().scenes.find((s) => s.name === 'Second');

    await store.getState().switchScene(target!.id);

    const outgoing = loadProjectScenes().scenes.find((s) => s.id === outgoingId);
    expect(outgoing?.data).toEqual(LIVE_SCENE);
    expect(loadProjectScenes().activeSceneId).toBe(target!.id);
  });

  it('loads a scene back with the contents it was saved with', async () => {
    const { dispatch, calls } = answeringDispatcher();
    setSceneDispatcher(dispatch);

    const originalId = loadProjectScenes().activeSceneId;
    store.getState().createNewScene('Second');
    const target = store.getState().scenes.find((s) => s.name === 'Second');

    await store.getState().switchScene(target!.id);
    await store.getState().switchScene(originalId);

    // Returning to a saved scene must replay its entities rather than fall
    // through to a blank `newScene()` — which is exactly what happened while
    // nothing ever populated `data`.
    const loads = calls.filter((c) => c.command === 'load_scene');
    expect(loads.length).toBeGreaterThan(0);
    expect(JSON.stringify(loads.at(-1)!.payload)).toContain('player');
  });

  it('duplicates the ACTIVE scene from its live contents, not a stale copy', async () => {
    const { dispatch } = answeringDispatcher();
    setSceneDispatcher(dispatch);

    const activeId = loadProjectScenes().activeSceneId;
    await store.getState().duplicateScene(activeId);

    const copy = loadProjectScenes().scenes.find((s) => s.name.endsWith('Copy'));
    expect(copy?.data).toEqual(LIVE_SCENE);
  });

  it('refuses to switch when the engine never answers, rather than losing the scene', async () => {
    vi.useFakeTimers();
    setSceneDispatcher((command) => command === 'validate_scene' ? { success: true } : undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    store.getState().createNewScene('Second');
    const target = store.getState().scenes.find((s) => s.name === 'Second');
    const before = loadProjectScenes().activeSceneId;

    const pending = store.getState().switchScene(target!.id);
    vi.advanceTimersByTime(SCENE_CAPTURE_TIMEOUT_MS);
    await pending;

    expect(loadProjectScenes().activeSceneId).toBe(before);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it('keeps the current scene selected when no engine can accept the switch', async () => {
    // Creating the target scene still needs an engine (scene.FR-3 hardening,
    // #10050) — the case under test is the SWITCH finding no engine, so the
    // dispatcher is cleared only after the target scene exists.
    setSceneDispatcher(answeringDispatcher().dispatch);
    store.getState().createNewScene('Second');
    const target = store.getState().scenes.find((s) => s.name === 'Second');
    const before = loadProjectScenes();
    setSceneDispatcher(null as unknown as (command: string, payload: unknown) => void);

    await store.getState().switchScene(target!.id);

    expect(loadProjectScenes()).toEqual(before);
    expect(store.getState().activeSceneId).toBe(before.activeSceneId);
  });

  // scene.FR-1 N1: linked prefab instances must survive save/reopen with zero
  // silent data loss. These drive the REAL switch path end to end — not the
  // isolated writePrefabInstances/readPrefabInstances helpers — because the bug
  // this guards is exactly that the helpers were never wired into it.
  describe('prefab-instance round-trip through the real switch path', () => {
    const INSTANCE: PrefabInstance = {
      instanceId: 'pfi_round',
      prefabId: 'prefab_src',
      overrides: { name: 'Overridden', entityType: 'sphere' },
      entityId: 'ent_1',
    };

    beforeEach(() => {
      // A portable saved link must have a real source definition.
      savePrefabsToStorage([{
        id: 'prefab_src', name: 'Source', category: 'test', description: '',
        createdAt: '2026-09-15T00:00:00Z', updatedAt: '2026-09-15T00:00:00Z',
        snapshot: { entityType: 'cube', name: 'Source', transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } },
      }]);
    });

    it('preserves links when switching to an unsaved scene is rejected', async () => {
      const { dispatch } = answeringDispatcher();
      setSceneDispatcher((command, payload) => {
        if (command === 'new_scene') {
          dispatch(command, payload);
          return { success: false, error: 'Rejected' };
        }
        return dispatch(command, payload);
      });
      store.getState().createNewScene('Unsaved');
      const target = store.getState().scenes.find((scene) => scene.name === 'Unsaved')!;
      const project = loadProjectScenes();
      project.scenes.find((scene) => scene.id === target.id)!.data = null;
      saveProjectScenes(project);
      savePrefabInstancesToStorage([INSTANCE]);

      await store.getState().switchScene(target.id);

      expect(loadPrefabInstances()).toEqual([INSTANCE]);
      expect(loadProjectScenes().activeSceneId).toBe(project.activeSceneId);
      expect(store.getState().activeSceneId).not.toBe(target.id);
    });

    it('does not restore an instance whose source was explicitly deleted', () => {
      savePrefabInstancesToStorage([INSTANCE]);
      store.getState().loadScene(JSON.stringify({ ...LIVE_SCENE, prefabInstances: [{ ...INSTANCE, prefabId: 'deleted' }] }));
      // With no dispatcher there is no transition, so the old registry remains.
      expect(loadPrefabInstances()).toEqual([INSTANCE]);
      setSceneDispatcher(() => ({ success: true }));
      store.getState().loadScene(JSON.stringify({ ...LIVE_SCENE, prefabInstances: [{ ...INSTANCE, prefabId: 'deleted' }] }));
      expect(loadPrefabInstances()).toEqual([]);
    });

    it('writes the live registry into the outgoing scene and restores it on return', async () => {
      const { dispatch } = answeringDispatcher();
      setSceneDispatcher(dispatch);

      const originalId = loadProjectScenes().activeSceneId;
      store.getState().createNewScene('Second');
      const target = store.getState().scenes.find((s) => s.name === 'Second');

      // The user has built a linked prefab instance in the active (original) scene.
      savePrefabInstancesToStorage([INSTANCE]);

      // Switch away: the instance must be folded into the outgoing scene's file...
      await store.getState().switchScene(target!.id);
      const outgoing = loadProjectScenes().scenes.find((s) => s.id === originalId);
      expect(readPrefabInstances(outgoing?.data)).toEqual([INSTANCE]);
      // ...and the empty incoming scene must reset the live registry so its
      // instances do not bleed across the scene boundary.
      expect(loadPrefabInstances()).toEqual([]);

      // Reopen the original scene: the registry must repopulate with the exact
      // instance — stable id, source link, overrides and entity binding intact.
      await store.getState().switchScene(originalId);
      const restored = loadPrefabInstances();
      expect(restored).toHaveLength(1);
      expect(restored[0].instanceId).toBe('pfi_round');
      expect(restored[0].prefabId).toBe('prefab_src');
      expect(restored[0].overrides).toEqual({ name: 'Overridden', entityType: 'sphere' });
      expect(restored[0].entityId).toBe('ent_1');
    });

    it('carries the live registry into a duplicated scene', async () => {
      const { dispatch } = answeringDispatcher();
      setSceneDispatcher(dispatch);

      const activeId = loadProjectScenes().activeSceneId;
      savePrefabInstancesToStorage([INSTANCE]);

      await store.getState().duplicateScene(activeId);

      const copy = loadProjectScenes().scenes.find((s) => s.name.endsWith('Copy'));
      expect(readPrefabInstances(copy?.data)).toEqual([INSTANCE]);
    });

    it('leaves an instance-free scene byte-identical (no empty prefabInstances field)', async () => {
      const { dispatch } = answeringDispatcher();
      setSceneDispatcher(dispatch);

      const originalId = loadProjectScenes().activeSceneId;
      store.getState().createNewScene('Second');
      const target = store.getState().scenes.find((s) => s.name === 'Second');

      // Registry is empty — deleting all instances must persist as "no instances",
      // and the outgoing scene file must not gain a spurious prefabInstances key.
      savePrefabInstancesToStorage([]);

      await store.getState().switchScene(target!.id);
      const outgoing = loadProjectScenes().scenes.find((s) => s.id === originalId);
      expect(outgoing?.data).toEqual(LIVE_SCENE);
      expect(outgoing?.data && 'prefabInstances' in outgoing.data).toBe(false);
    });
  });

  it('preserves the last saved project when no engine is connected', async () => {
    setSceneDispatcher(answeringDispatcher().dispatch);
    store.getState().createNewScene('Second');
    const target = store.getState().scenes.find((s) => s.name === 'Second');
    const before = localStorage.getItem('forge-project-scenes');
    setSceneDispatcher(null);
    await store.getState().switchScene(target!.id);
    expect(localStorage.getItem('forge-project-scenes')).toBe(before);
  });

  /**
   * #10056. These two capture the LIVE engine scene and write it into stored
   * project data. After a rejected load the engine is not holding this
   * project's scene, so capturing would persist an empty scene over the
   * outgoing one — the same data loss as the cloud-save path, one storage layer
   * down. `captureActiveScene` also uses an un-prefixed request id, so its
   * export would additionally tick autosave and the panic backup.
   */
  describe('refusing to capture a rejected scene (#10056)', () => {
    /** Reject a load so `sceneLoadError` is set, then restore `dispatch`. */
    function rejectALoad(restore: (command: string, payload: unknown) => unknown) {
      setSceneDispatcher(vi.fn(() => ({ success: false, error: 'Scene JSON too large' })));
      expect(store.getState().loadScene(JSON.stringify(sceneFixture('Rejected')))).toBe(false);
      expect(store.getState().sceneLoadError).not.toBeNull();
      setSceneDispatcher(restore as (command: string, payload: unknown) => void);
    }

    it('switchScene neither exports nor overwrites the outgoing scene', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { dispatch, calls } = answeringDispatcher();
      setSceneDispatcher(dispatch);
      const outgoingId = loadProjectScenes().activeSceneId;
      store.getState().createNewScene('Second');
      const target = store.getState().scenes.find((s) => s.name === 'Second');

      rejectALoad(dispatch);
      calls.length = 0;

      await store.getState().switchScene(target!.id);

      expect(calls.filter((c) => c.command === 'export_scene')).toHaveLength(0);
      expect(loadProjectScenes().scenes.find((s) => s.id === outgoingId)?.data).not.toEqual(LIVE_SCENE);
      // The switch did not happen either — a half-applied switch would be worse.
      expect(loadProjectScenes().activeSceneId).toBe(outgoingId);
      expect(error).toHaveBeenCalled();
      error.mockRestore();
    });

    it('createCheckpoint refuses and reports why instead of recording an empty scene', async () => {
      const { dispatch, calls } = answeringDispatcher();
      setSceneDispatcher(dispatch);
      rejectALoad(dispatch);
      calls.length = 0;

      const checkpoint = await store.getState().createCheckpoint('before refactor');

      expect(checkpoint).toBeNull();
      expect(calls.filter((c) => c.command === 'export_scene')).toHaveLength(0);
      expect(store.getState().checkpointError).toContain('No checkpoint was saved');
    });
  });
});
