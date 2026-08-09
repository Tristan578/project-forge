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
import { createSliceStore } from './sliceTestTemplate';
import { createSceneSlice, setSceneDispatcher, type SceneSlice } from '../sceneSlice';
import { loadProjectScenes, saveProjectScenes } from '@/lib/scenes/sceneManager';
import { SCENE_EXPORTED_EVENT, SCENE_CAPTURE_TIMEOUT_MS } from '@/lib/scenes/captureScene';

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
  let store: ReturnType<typeof createSliceStore<SceneSlice>>;

  beforeEach(() => {
    localStorage.clear();
    // `loadProjectScenes()` mints a fresh throwaway project on every call until
    // something persists one, so the ids it hands back are only stable once the
    // initial project is written down. Seed it, or every assertion here would be
    // comparing against a scene that no later call has ever heard of.
    saveProjectScenes(loadProjectScenes());
    store = createSliceStore(createSceneSlice);
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
});
