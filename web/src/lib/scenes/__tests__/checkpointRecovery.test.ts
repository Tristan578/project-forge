// @vitest-environment jsdom
/** Unrelated and legacy export events cannot confirm a recovery operation. */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { captureCheckpointScene, applyCheckpointScene, SCENE_LOADED_EVENT } from '../checkpointRecovery';
import { SCENE_EXPORTED_EVENT } from '@/lib/engine/sceneExportWire';
import { attachFixtureValidator, sceneFixture } from './sceneFixture';
import { setSceneValidator } from '../sceneValidation';

afterEach(() => { setSceneValidator(null); vi.useRealTimers(); });

describe('checkpoint engine confirmation', () => {
  it('ignores missing and wrong request IDs before accepting its own export', async () => {
    attachFixtureValidator();
    let id = '';
    let settled = false;
    const pending = captureCheckpointScene((requestId) => { id = requestId; return true; });
    void pending.then(() => { settled = true; });
    const emit = (requestId?: string) => window.dispatchEvent(new CustomEvent(SCENE_EXPORTED_EVENT, {
      detail: { json: JSON.stringify(sceneFixture('Live')), requestId },
    }));
    emit();
    emit('someone-else');
    await Promise.resolve();
    expect(settled).toBe(false);
    emit(id);
    expect((await pending).metadata?.name).toBe('Live');
  });

  it('does not accept a scene graph change or queued acknowledgement without SCENE_LOADED', async () => {
    vi.useFakeTimers();
    attachFixtureValidator();
    const exportScene = vi.fn(() => true);
    const pending = applyCheckpointScene(sceneFixture('Target'), () => true, exportScene, () => true, 20);
    const failure = expect(pending).rejects.toThrow('did not apply');
    await vi.advanceTimersByTimeAsync(20);
    await failure;
    expect(exportScene).not.toHaveBeenCalled();
  });

  it('requires a valid scene readback after the load event', async () => {
    attachFixtureValidator();
    const pending = applyCheckpointScene(sceneFixture('Target'), () => {
      window.dispatchEvent(new CustomEvent(SCENE_LOADED_EVENT));
      return true;
    }, (requestId) => {
      window.dispatchEvent(new CustomEvent(SCENE_EXPORTED_EVENT, {
        detail: { json: JSON.stringify({ formatVersion: 3, entities: [] }), requestId },
      }));
      return true;
    }, () => true);
    await expect(pending).rejects.toThrow('invalid scene');
  });

  it('cleans up after a dispatcher throws so later exports cannot complete the request', async () => {
    attachFixtureValidator();
    await expect(captureCheckpointScene(() => { throw new Error('Disconnected'); })).rejects.toThrow('Disconnected');
  });
  function entityScene(position: number) {
    return {
      ...sceneFixture('Same name'),
      entities: [{
        entityId: 'cube-1', entityType: 'cube', name: 'Cube',
        transform: { position: [position, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
        parentId: null, visible: true, materialData: null, lightData: null, physicsData: null, physicsEnabled: false,
      }],
    };
  }

  function applyWithReadback(expected: ReturnType<typeof entityScene>, actual: unknown) {
    return applyCheckpointScene(expected, () => {
      window.dispatchEvent(new CustomEvent(SCENE_LOADED_EVENT));
      return true;
    }, (requestId) => {
      window.dispatchEvent(new CustomEvent(SCENE_EXPORTED_EVENT, {
        detail: { json: JSON.stringify(actual), requestId },
      }));
      return true;
    }, () => true);
  }

  it('rejects different entity transforms even when the scene name matches', async () => {
    attachFixtureValidator();
    await expect(applyWithReadback(entityScene(1), entityScene(2))).rejects.toThrow('different scene data');
  });

  it('accepts entity ordering and float serialization differences without losing field checks', async () => {
    attachFixtureValidator();
    const expected = entityScene(0.1);
    expected.entities.push({ ...expected.entities[0], entityId: 'cube-2' });
    const actual = { ...expected, entities: [...expected.entities].reverse().map((entity) => ({
      ...entity,
      transform: { ...entity.transform, position: [Math.fround(0.1), 0, 0] },
      audioData: null,
    })) };
    await expect(applyWithReadback(expected, actual)).resolves.toBeUndefined();
  });

  it('accepts a readback without the completion mode, which the engine never echoes (#9998)', async () => {
    // The mode is editor-side metadata like `prefabInstances`: the engine
    // ignores the key on load and never writes it on export, so a checkpoint
    // that records it must not fail its own engine-application check.
    attachFixtureValidator();
    const expected = { ...entityScene(0), completionMode: 'sandbox' as const };
    await expect(applyWithReadback(expected, entityScene(0))).resolves.toBeUndefined();
  });

  it('still rejects a readback that differs in engine data when a mode is recorded', async () => {
    attachFixtureValidator();
    const expected = { ...entityScene(1), completionMode: 'sandbox' as const };
    await expect(applyWithReadback(expected, entityScene(2))).rejects.toThrow('different scene data');
  });

});
