// @vitest-environment jsdom
/**
 * scene.FR-3.OP-02 — checkpoint error handling (#9813 review findings).
 *
 * Recovery checkpoints share the same `localStorage.setItem` path as the
 * rest of the scene manager, so a quota or storage error there must degrade
 * gracefully — a caught error and a defined return value — rather than
 * throw through a Zustand action or leave an async chat-tool call rejected.
 * Each test below reproduces one of the review findings on PR #10050:
 *  - `deleteCheckpoint`'s unguarded `localStorage.setItem` (sceneManager.ts)
 *    is now caught at both call sites (this file covers the store action;
 *    `sceneManagementHandlers.test.ts` covers the AI handler).
 *  - `createCheckpoint`'s fold-in `saveProjectScenes` call used to run
 *    outside its own try block and could reject the async action.
 *  - `restoreCheckpoint` used to report success even when the engine
 *    rejected the scene load, leaving the live viewport out of sync with
 *    what storage says is now active.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createSceneTestStore } from './sceneSliceTestStore';
import { setSceneDispatcher } from '../sceneSlice';
import {
  saveProjectScenes,
  loadProjectScenes,
  createCheckpoint,
  type ProjectScenes,
  type SceneCheckpoint,
} from '@/lib/scenes/sceneManager';
import { captureActiveScene } from '@/lib/scenes/captureScene';

vi.mock('@/lib/scenes/captureScene', () => ({
  captureActiveScene: vi.fn(async () => ({ status: 'unavailable' as const })),
}));

/** A project whose active scene has real `data`, so restoring it actually
 *  reaches `loadScene` instead of falling through to `newScene()`. */
function makeProject(activeName: string): ProjectScenes {
  return {
    version: '1.0',
    activeSceneId: 'scene_1',
    scenes: [
      {
        id: 'scene_1',
        name: activeName,
        isStartScene: true,
        data: { formatVersion: 3, sceneName: activeName, entities: [{ id: 'e1' }] },
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
  };
}

describe('sceneSlice checkpoint actions survive a broken localStorage', () => {
  let store: ReturnType<typeof createSceneTestStore>['store'];
  let setItemSpy: ReturnType<typeof vi.spyOn> | undefined;

  beforeEach(() => {
    localStorage.clear();
    saveProjectScenes(makeProject('Main'));
    store = createSceneTestStore().store;
    setSceneDispatcher(() => undefined);
    vi.mocked(captureActiveScene).mockResolvedValue({ status: 'unavailable' });
  });

  afterEach(() => {
    setSceneDispatcher(null as unknown as (command: string, payload: unknown) => void);
    setItemSpy?.mockRestore();
    vi.clearAllMocks();
  });

  it('createCheckpoint catches a quota error raised while folding the captured scene in, not just the checkpoint write itself', async () => {
    vi.mocked(captureActiveScene).mockResolvedValueOnce({
      status: 'captured',
      data: { formatVersion: 3, sceneName: 'Main', entities: [] },
    });
    setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota exceeded', 'QuotaExceededError');
    });

    await expect(store.getState().createCheckpoint('quota-test')).resolves.toBeNull();
  });

  it('restoreCheckpoint catches a storage error from the underlying atomic save instead of throwing', () => {
    const { checkpoint } = createCheckpoint(loadProjectScenes());
    setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota exceeded', 'QuotaExceededError');
    });

    let ok: boolean | undefined;
    expect(() => {
      ok = store.getState().restoreCheckpoint(checkpoint.id);
    }).not.toThrow();
    expect(ok).toBe(false);
  });

  it('restoreCheckpoint reports failure, without throwing, when the engine rejects the scene load', () => {
    const { checkpoint } = createCheckpoint(loadProjectScenes());
    setSceneDispatcher(() => ({ success: false, error: 'Scene JSON too large' }));

    const ok = store.getState().restoreCheckpoint(checkpoint.id);

    expect(ok).toBe(false);
    // Storage was still restored — only the live viewport is stale, which is
    // exactly the state the review flagged as silently reported as success.
    expect(loadProjectScenes()).toEqual(checkpoint.snapshot);
  });

  it('deleteCheckpoint catches a storage error instead of throwing through the Trash2 handler', () => {
    const { checkpoint } = createCheckpoint(loadProjectScenes());
    setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });

    let remaining: SceneCheckpoint[] = [];
    expect(() => {
      remaining = store.getState().deleteCheckpoint(checkpoint.id);
    }).not.toThrow();
    // The write failed, so the checkpoint the caller asked to delete is
    // still there — the action degrades to "unchanged", never a crash.
    expect(remaining.map((c) => c.id)).toContain(checkpoint.id);
  });
});
