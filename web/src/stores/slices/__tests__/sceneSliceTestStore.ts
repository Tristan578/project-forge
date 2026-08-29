/**
 * Isolated store for `createSceneSlice`.
 *
 * `loadTemplate` reads and writes across slice boundaries — it watches
 * `sceneGraph`/`nodeCount` to know the engine actually applied the scene, then
 * attaches the template's scripts and game components through their owning
 * slices — so the slice's generic is widened and `createSliceStore` (which
 * assumes a self-contained slice) can no longer build it. Same shape as the
 * `primaryId` store in `scriptSlice.test.ts`.
 */
import { create } from 'zustand';
import { vi } from 'vitest';
import { createSceneSlice, type SceneSlice, type TemplateApplyDeps } from '../sceneSlice';

export type SceneTestState = SceneSlice & TemplateApplyDeps;

export function createSceneTestStore() {
  const setScript = vi.fn();
  const setInputPreset = vi.fn();
  const addGameComponent = vi.fn();

  const store = create<SceneTestState>()((set, get, api) => ({
    ...createSceneSlice(set, get, api),
    sceneGraph: { nodes: {}, rootIds: [] },
    nodeCount: 0,
    setScript,
    setInputPreset,
    addGameComponent,
  }));

  return { store, setScript, setInputPreset, addGameComponent };
}
