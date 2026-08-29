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
import type { SceneNode } from '../types';

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

/**
 * A dispatcher that behaves like the engine for `load_scene`: it spawns the
 * entities the payload describes and the scene graph appears in the store,
 * exactly as SCENE_GRAPH_UPDATE would deliver it a frame later. Anything the
 * scene file cannot express (an entity type the engine has no variant for)
 * never reaches this point, so what lands here is what the user would see.
 */
export function createFakeEngineDispatcher(store: ReturnType<typeof createSceneTestStore>['store']) {
  return vi.fn((command: string, payload: unknown): { success: boolean; error?: string } | void => {
    if (command !== 'load_scene') return;
    const scene = JSON.parse((payload as { json: string }).json) as {
      entities: Array<{ entityId: string; name: string; parentId: string | null; visible: boolean }>;
    };
    const nodes: Record<string, SceneNode> = {};
    for (const entity of scene.entities) {
      nodes[entity.entityId] = {
        entityId: entity.entityId,
        name: entity.name,
        parentId: entity.parentId,
        children: [],
        visible: entity.visible,
        components: [],
      };
    }
    store.setState({
      sceneGraph: {
        nodes,
        rootIds: scene.entities.filter((e) => e.parentId === null).map((e) => e.entityId),
      },
      nodeCount: scene.entities.length,
    });
  });
}
