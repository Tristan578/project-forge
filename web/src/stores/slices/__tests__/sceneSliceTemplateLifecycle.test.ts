// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSceneTestStore, type SceneTestState } from './sceneSliceTestStore';
import { setSceneDispatcher } from '../sceneSlice';
import type { SceneGraph, SceneNode } from '../types';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: { getState: vi.fn(), setState: vi.fn() },
}));
vi.mock('@/lib/audio/entityAudioGraph', () => ({
  releaseEntityAudio: vi.fn(),
  resetEntityAudioGraphForScene: vi.fn(),
}));
vi.mock('@/lib/ai/cachedContext', () => ({ invalidateSceneCache: vi.fn() }));
vi.mock('@/lib/storage/autoSave', () => ({ setLastExportedScene: vi.fn() }));
vi.mock('@/lib/sceneFile', () => ({ saveAutoSave: vi.fn() }));

import { useEditorStore } from '@/stores/editorStore';
import { handleTransformEvent } from '@/hooks/events/transformEvents';
import { clearStagedSceneAudio } from '@/lib/audio/sceneAudioManifest';
import { buildTemplateSceneFile } from '@/lib/templates/templateSceneFile';
import { SCENE_EXPORTED_EVENT, type SceneExportedDetail } from '@/lib/engine/sceneExportWire';
import {
  loadPrefabInstances,
  savePrefabInstancesToStorage,
  savePrefabsToStorage,
  type Prefab,
  type PrefabInstance,
} from '@/lib/prefabs/prefabStore';

const SOURCE: Prefab = {
  id: 'source',
  name: 'Source',
  category: 'test',
  description: '',
  createdAt: '2026-09-15T00:00:00Z',
  updatedAt: '2026-09-15T00:00:00Z',
  snapshot: {
    entityType: 'cube',
    name: 'Source',
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
  },
};
const OLD_LINK: PrefabInstance = {
  instanceId: 'old-link', prefabId: SOURCE.id, entityId: 'old-player', overrides: {},
};
const NEW_LINK: PrefabInstance = {
  instanceId: 'new-link', prefabId: SOURCE.id, entityId: 'player', overrides: { name: 'New player' },
};
const NEW_SCENE = JSON.stringify({
  formatVersion: 3,
  sceneName: 'Newer scene',
  entities: [{
    entityId: 'player', name: 'New player', entityType: 'cube', parentId: null, visible: true,
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
  }],
  prefabInstances: [NEW_LINK],
});

describe('template load lifecycle through engine events', () => {
  let harness: ReturnType<typeof createSceneTestStore>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    localStorage.clear();
    sessionStorage.clear();
    clearStagedSceneAudio();
    harness = createSceneTestStore();
    savePrefabsToStorage([SOURCE]);
    savePrefabInstancesToStorage([OLD_LINK]);
    vi.mocked(useEditorStore.getState).mockImplementation(() => ({
      ...harness.store.getState(),
      recomputeLightState: vi.fn(),
      setFullGraph: (sceneGraph: SceneGraph) => harness.store.setState({
        sceneGraph, nodeCount: Object.keys(sceneGraph.nodes).length,
      }),
    }) as unknown as ReturnType<typeof useEditorStore.getState>);
    vi.mocked(useEditorStore.setState).mockImplementation((partial) => {
      harness.store.setState(partial as Partial<SceneTestState>);
    });
  });

  afterEach(() => {
    setSceneDispatcher(null as unknown as Parameters<typeof setSceneDispatcher>[0]);
    clearStagedSceneAudio();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  function deliver(type: string, data: Record<string, unknown>) {
    expect(handleTransformEvent(type, data, useEditorStore.setState, useEditorStore.getState)).toBe(true);
  }

  function applyScene(json: string, emitLoaded = true) {
    const scene = JSON.parse(json) as {
      sceneName: string;
      entities: Array<{ entityId: string; name: string; parentId: string | null; visible: boolean }>;
    };
    const nodes: Record<string, SceneNode> = {};
    for (const entity of scene.entities) {
      nodes[entity.entityId] = { ...entity, children: [], components: [] };
    }
    if (emitLoaded) deliver('SCENE_LOADED', { name: scene.sceneName });
    deliver('SCENE_GRAPH_UPDATE', {
      nodes, rootIds: scene.entities.filter((entity) => entity.parentId === null).map((entity) => entity.entityId),
    });
  }

  function exportedScene(json: string): Record<string, unknown> {
    const listener = vi.fn<(event: Event) => void>();
    window.addEventListener(SCENE_EXPORTED_EVENT, listener);
    try {
      deliver('SCENE_EXPORTED', { json, name: 'Exported scene' });
    } finally {
      window.removeEventListener(SCENE_EXPORTED_EVENT, listener);
    }
    const detail = (listener.mock.calls[0][0] as CustomEvent<SceneExportedDetail>).detail;
    return JSON.parse(detail.json) as Record<string, unknown>;
  }

  async function queueTemplate() {
    let resolveQueued!: (json: string) => void;
    const queued = new Promise<string>((resolve) => { resolveQueued = resolve; });
    setSceneDispatcher((command, payload) => {
      if (command === 'load_scene') resolveQueued((payload as { json: string }).json);
      return { success: true };
    });
    const result = harness.store.getState().loadTemplate('2d-platformer', { timeoutMs: 50 });
    return { result, json: await queued };
  }

  it('waits for a fresh nodes map after SCENE_LOADED when reloading the same template', async () => {
    const { loadTemplate: readTemplate } = await import('@/data/templates');
    const template = await readTemplate('2d-platformer');
    // The outgoing scene even has the same IDs and count as the incoming one.
    // SCENE_LOADED clones its graph while retaining its old nodes map.
    applyScene(buildTemplateSceneFile(template!).sceneJson);
    const { result, json } = await queueTemplate();
    let finished = false;
    void result.then(() => { finished = true; });
    deliver('SCENE_LOADED', { name: JSON.parse(json).sceneName });
    await Promise.resolve();
    await Promise.resolve();

    expect(finished).toBe(false);
    expect(harness.setScript).not.toHaveBeenCalled();
    expect(harness.addGameComponent).not.toHaveBeenCalled();

    applyScene(json, false);
    expect(await result).toMatchObject({ success: true });
    expect(harness.setScript).toHaveBeenCalled();
  });

  it.each(['wrong ID at the expected count', 'expected IDs plus an extra node'] as const)(
    'waits through a fresh graph with %s before applying template scripts',
    async (mismatch) => {
      const { loadTemplate: readTemplate } = await import('@/data/templates');
      const template = await readTemplate('2d-platformer');
      const { result, json } = await queueTemplate();
      const scene = JSON.parse(json) as {
        sceneName: string;
        entities: Array<{ entityId: string; name: string; parentId: string | null; visible: boolean }>;
      };
      const nodes: Record<string, SceneNode> = Object.fromEntries(
        scene.entities.map((entity) => [entity.entityId, { ...entity, children: [], components: [] }]),
      );
      const firstId = scene.entities[0].entityId;
      const unexpected = { ...nodes[firstId], entityId: 'unrelated-node', name: 'Unrelated node' };
      if (mismatch === 'wrong ID at the expected count') delete nodes[firstId];
      nodes[unexpected.entityId] = unexpected;
      let finished = false;
      void result.then(() => { finished = true; });

      deliver('SCENE_LOADED', { name: scene.sceneName });
      deliver('SCENE_GRAPH_UPDATE', {
        nodes,
        rootIds: Object.values(nodes).filter((node) => node.parentId === null).map((node) => node.entityId),
      });
      await Promise.resolve();
      await Promise.resolve();

      expect(harness.store.getState().nodeCount).toBe(
        scene.entities.length + (mismatch === 'expected IDs plus an extra node' ? 1 : 0),
      );
      expect(finished).toBe(false);
      expect(harness.setScript).not.toHaveBeenCalled();
      expect(harness.addGameComponent).not.toHaveBeenCalled();

      applyScene(json, false);

      expect(await result).toEqual({
        success: true, entityCount: scene.entities.length, skippedEntityIds: ['camera'],
      });
      const expectedIds = new Set(scene.entities.map((entity) => entity.entityId));
      expect(harness.setScript.mock.calls).toEqual(
        Object.entries(template!.scripts)
          .filter(([entityId]) => expectedIds.has(entityId))
          .map(([entityId, script]) => [entityId, script.source, script.enabled]),
      );
      expect(harness.setScript).toHaveBeenCalled();
    },
  );

  it('does not attach outgoing prefab links to a template that lands after timeout', async () => {
    const { result, json } = await queueTemplate();
    await vi.advanceTimersByTimeAsync(50);
    expect(await result).toMatchObject({
      success: false, error: expect.stringContaining('may change after this timeout'),
    });

    // A timeout unsubscribes the waiter; it cannot remove the Rust load request.
    // Exercise the actual event producer used by every export consumer afterward.
    applyScene(json);
    const exported = exportedScene(json);

    expect(harness.store.getState().sceneName).toBe(JSON.parse(json).sceneName);
    expect(harness.store.getState().sceneGraph.nodes.player).toBeDefined();
    expect(loadPrefabInstances()).toEqual([]);
    expect(exported.prefabInstances).toBeUndefined();
    expect(exported.prefabDefinitions).toBeUndefined();
    expect(JSON.parse(sessionStorage.getItem('forge:scene-last-json')!)).toEqual(exported);
    expect(harness.setScript).not.toHaveBeenCalled();
  });

  it('preserves a newer loaded scene registry when an older template times out', async () => {
    const { result } = await queueTemplate();
    expect(harness.store.getState().loadScene(NEW_SCENE)).toBe(true);
    await vi.advanceTimersByTimeAsync(50);

    expect(await result).toEqual({
      success: false, error: 'Another scene was requested before this template finished loading.',
    });
    expect(loadPrefabInstances()).toEqual([NEW_LINK]);
    applyScene(NEW_SCENE);
    expect(exportedScene(NEW_SCENE).prefabInstances).toEqual([NEW_LINK]);
    expect(harness.setScript).not.toHaveBeenCalled();
    expect(harness.addGameComponent).not.toHaveBeenCalled();
  });

  it('does not attach an older template script when a newer scene satisfies the graph waiter', async () => {
    const { result, json } = await queueTemplate();
    const newer = JSON.stringify({
      ...JSON.parse(json), sceneName: 'Newer scene', prefabInstances: [NEW_LINK],
    });
    // A same-frame dispatcher can satisfy the old waiter's expected IDs before
    // loadScene increments its accepted-operation revision. The continuation
    // must check the revision again before installing scripts or components.
    setSceneDispatcher((command, payload) => {
      if (command === 'load_scene') applyScene((payload as { json: string }).json);
      return { success: true };
    });
    expect(harness.store.getState().loadScene(newer)).toBe(true);

    expect(await result).toMatchObject({ success: false, error: expect.stringContaining('Another scene') });
    expect(harness.store.getState().sceneName).toBe('Newer scene');
    expect(loadPrefabInstances()).toEqual([NEW_LINK]);
    expect(harness.setScript).not.toHaveBeenCalled();
    expect(harness.addGameComponent).not.toHaveBeenCalled();
  });

  it.each(
    (['load', 'new', 'template'] as const).flatMap((operation) =>
      (['rejected', 'throws', 'unavailable'] as const).map((failure) => ({ operation, failure })),
    ),
  )('preserves pending audio and links when a competing $operation is $failure', async ({ operation, failure }) => {
    const audio = {
      assetId: 'pending-scene-clip', volume: 0.75, pitch: 1, loopAudio: true,
      spatial: false, maxDistance: 50, refDistance: 1, rolloffFactor: 1, autoplay: true, bus: 'music',
    };
    const pendingScene = JSON.parse(NEW_SCENE);
    pendingScene.entities[0].audioData = audio;
    const pendingJson = JSON.stringify(pendingScene);
    setSceneDispatcher(() => ({ success: true }));
    expect(harness.store.getState().loadScene(pendingJson)).toBe(true);
    const acceptedRevision = harness.store.getState().sceneOperationRevision;

    if (failure === 'unavailable') {
      setSceneDispatcher(null as unknown as Parameters<typeof setSceneDispatcher>[0]);
    } else {
      setSceneDispatcher(() => {
        if (failure === 'throws') throw new Error('Engine dispatch failed');
        return { success: false, error: 'Engine refused the competing scene' };
      });
    }
    const state = harness.store.getState();
    const result = operation === 'template'
      ? (await state.loadTemplate('2d-platformer', { timeoutMs: 50 })).success
      : operation === 'load' ? state.loadScene(NEW_SCENE) : state.newScene();

    expect(result).toBe(false);
    expect(loadPrefabInstances()).toEqual([NEW_LINK]);
    if (operation !== 'template') {
      expect(harness.store.getState().sceneOperationRevision).toBe(acceptedRevision);
    }
    applyScene(pendingJson);
    expect(useEditorStore.getState().entityAudio).toEqual({ player: audio });
    expect(exportedScene(pendingJson).prefabInstances).toEqual([NEW_LINK]);
  });

  it('does not queue an older template after a new scene is accepted during import', async () => {
    const dispatch = vi.fn(() => ({ success: true }));
    setSceneDispatcher(dispatch);
    const result = harness.store.getState().loadTemplate('2d-platformer', { timeoutMs: 50 });
    expect(harness.store.getState().newScene()).toBe(true);

    expect(await result).toMatchObject({ success: false, error: expect.stringContaining('Another scene') });
    expect(dispatch.mock.calls).toEqual([['new_scene', {}]]);
    expect(loadPrefabInstances()).toEqual([]);
    expect(harness.setScript).not.toHaveBeenCalled();
  });
});
