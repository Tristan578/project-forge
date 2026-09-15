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
  savePrefabInstancesToStorage,
  type PrefabInstance,
} from '@/lib/prefabs/prefabStore';

const LIVE_SCENE = {
  formatVersion: 1,
  sceneName: 'Level 1',
  entities: [{ id: 'player' }, { id: 'goal' }],
};

/** A dispatcher that answers `export_scene` the way the engine bridge does. */
function answeringDispatcher() {
  const calls: Array<{ command: string; payload: unknown }> = [];
  const dispatch = (command: string, payload: unknown) => {
    calls.push({ command, payload });
    if (command === 'export_scene') {
      window.dispatchEvent(
        new CustomEvent(SCENE_EXPORTED_EVENT, {
          detail: { json: JSON.stringify(LIVE_SCENE), name: LIVE_SCENE.sceneName },
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
    setSceneDispatcher(() => {
      /* engine is wedged — the export request is never answered */
    });
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

  it('still switches when no engine is connected — there is no live scene to lose', async () => {
    store.getState().createNewScene('Second');
    const target = store.getState().scenes.find((s) => s.name === 'Second');

    await store.getState().switchScene(target!.id);

    expect(loadProjectScenes().activeSceneId).toBe(target!.id);
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
});
