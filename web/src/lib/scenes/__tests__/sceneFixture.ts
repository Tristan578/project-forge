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
    const valid = !!scene.metadata && typeof scene.metadata.name === 'string' &&
      Array.isArray(scene.entities) && scene.entities.every((entity: Record<string, unknown>) =>
        typeof entity.entityId === 'string' && !!entity.transform);
    return valid ? { valid: true } : { valid: false, reason: 'Invalid scene file: fixture decoder refused it' };
  });
}

/**
 * How the engine answers the NEXT `load_scene`. Every mode is one-shot and
 * falls back to `apply`. `threw` is the shape the editor's own dispatcher
 * (`useEngineEvents`) produces when the engine call throws: a caught throw
 * answered as `{ success: false, error, threw: true }`, which the store
 * re-raises as `EngineDispatchThrewError` (#10202). Nothing is applied for
 * it, so the test is deterministic.
 */
type CheckpointEngineMode = 'apply' | 'reject' | 'threw' | 'silent' | 'wrong';

/** Queue commands, then emit application/export events as the bridge does. */
export function attachCheckpointEngine(initial = sceneFixture('Live')) {
  let current = initial;
  let mode: CheckpointEngineMode = 'apply';
  // Modes for the next loads in order, for a flow that dispatches more than
  // one `load_scene` before the test regains control (a restore whose
  // recovery of the prior scene must also fail). Consumed before `mode`.
  let queued: CheckpointEngineMode[] = [];
  const dispatch = vi.fn((command: string, payload: unknown) => {
    if (command === 'validate_scene') return { success: true };
    if (command === 'export_scene') {
      const { requestId } = payload as { requestId: string };
      queueMicrotask(() => window.dispatchEvent(new CustomEvent(SCENE_EXPORTED_EVENT, {
        detail: { json: JSON.stringify(current), name: current.metadata?.name, requestId },
      })));
    }
    if (command === 'load_scene') {
      const answerAs = queued.length > 0 ? queued.shift()! : mode;
      mode = 'apply';
      if (answerAs === 'reject') return { success: false, error: 'Refused' };
      if (answerAs === 'threw') return { success: false, error: 'Engine failed', threw: true as const };
      if (answerAs === 'silent') return { success: true };
      const next = JSON.parse((payload as { json: string }).json) as SceneFileData;
      const wrong = answerAs === 'wrong';
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
    /** The next load answers this way (and any queued sequence is dropped). */
    setMode: (value: CheckpointEngineMode) => { mode = value; queued = []; },
    /** The next loads answer this way, in order, then `apply`. */
    setModes: (values: CheckpointEngineMode[]) => { queued = [...values]; mode = 'apply'; },
  };
}
