/** Valid SceneFile fixtures and a queued engine transport for recovery tests. */
import { vi } from 'vitest';
import { emptySceneFile, setSceneValidator } from '../sceneValidation';
import { SCENE_LOADED_EVENT } from '../checkpointRecovery';
import { SCENE_EXPORTED_EVENT } from '@/lib/engine/sceneExportWire';
import { setSceneDispatcher } from '@/stores/slices/sceneSlice';
import type { SceneFileData, ProjectScenes } from '../sceneManager';

export function sceneFixture(name: string): SceneFileData {
  return emptySceneFile(name);
}

export function projectFixture(name: string): ProjectScenes {
  return {
    version: '1.0', activeSceneId: 'scene_1',
    scenes: [{
      id: 'scene_1', name, isStartScene: true, data: sceneFixture(name),
      createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    }],
  };
}

/** Storage unit tests isolate the Rust decoder; engine tests own serde fidelity. */
export function attachFixtureValidator(): void {
  setSceneValidator((json) => {
    const scene = JSON.parse(json);
    return !!scene.metadata && typeof scene.metadata.name === 'string' &&
      Array.isArray(scene.entities) && scene.entities.every((entity: Record<string, unknown>) =>
        typeof entity.entityId === 'string' && !!entity.transform);
  });
}

/** Queue commands, then emit application/export events as the bridge does. */
export function attachCheckpointEngine(initial = sceneFixture('Live')) {
  let current = initial;
  let mode: 'apply' | 'reject' | 'silent' | 'wrong' = 'apply';
  const dispatch = vi.fn((command: string, payload: unknown) => {
    if (command === 'validate_scene') return { success: true };
    if (command === 'export_scene') {
      const { requestId } = payload as { requestId: string };
      queueMicrotask(() => window.dispatchEvent(new CustomEvent(SCENE_EXPORTED_EVENT, {
        detail: { json: JSON.stringify(current), name: current.metadata?.name, requestId },
      })));
    }
    if (command === 'load_scene') {
      if (mode === 'reject') { mode = 'apply'; return { success: false, error: 'Refused' }; }
      if (mode === 'silent') { mode = 'apply'; return { success: true }; }
      const next = JSON.parse((payload as { json: string }).json) as SceneFileData;
      const wrong = mode === 'wrong';
      mode = 'apply';
      queueMicrotask(() => {
        current = wrong ? sceneFixture('Wrong scene') : next;
        window.dispatchEvent(new CustomEvent(SCENE_LOADED_EVENT));
      });
    }
    return { success: true };
  });
  setSceneDispatcher(dispatch);
  return {
    dispatch,
    getScene: () => current,
    setScene: (scene: SceneFileData) => { current = scene; },
    setMode: (value: typeof mode) => { mode = value; },
  };
}
