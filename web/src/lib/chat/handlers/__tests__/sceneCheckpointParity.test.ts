// @vitest-environment jsdom
/**
 * scene.FR-3.OP-02 — manual/AI parity for recovery checkpoints.
 *
 * This suite uses the REAL sceneManager and a REAL scene-slice store against a
 * real jsdom localStorage. It proves the in-app AI path (the
 * `create_checkpoint` / `restore_checkpoint` chat handlers) persists the exact
 * same state as the manual-control path (the `createCheckpoint` /
 * `restoreCheckpoint` store actions the Scene Browser buttons call) — they are
 * one implementation, not two.
 *
 * Only the engine capture is mocked; there is no engine attached in a unit
 * test, so a real capture would just time out. Everything else is real.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { invokeHandler } from './handlerTestUtils';
import { sceneManagementHandlers } from '../sceneManagementHandlers';
import { createSceneTestStore } from '@/stores/slices/__tests__/sceneSliceTestStore';
import { setSceneDispatcher } from '@/stores/slices/sceneSlice';
import {
  saveProjectScenes,
  loadProjectScenes,
  listCheckpoints,
  type ProjectScenes,
} from '@/lib/scenes/sceneManager';

// No engine attached — capture reports "nothing live to lose" so both paths
// snapshot exactly what is on disk.
vi.mock('@/lib/scenes/captureScene', () => ({
  captureActiveScene: vi.fn(async () => ({ status: 'unavailable' as const })),
}));

const SCENES_STORAGE_KEY = 'forge-project-scenes';

function seedProject(tag: string): ProjectScenes {
  const project: ProjectScenes = {
    version: '1.0',
    activeSceneId: 'scene_1',
    scenes: [
      {
        id: 'scene_1',
        name: 'Main',
        isStartScene: true,
        data: { formatVersion: 3, sceneName: 'Main', entities: [{ id: 'e1', tag }] },
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'scene_2',
        name: 'Level 2',
        isStartScene: false,
        data: { formatVersion: 3, sceneName: 'Level 2', entities: [{ id: 'e2', tag }] },
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
  };
  saveProjectScenes(project);
  return project;
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  // The manual `restoreCheckpoint` store action now reports whether the
  // engine accepted the scene load, not just whether storage was restored
  // (scene.FR-3.OP-02's #9813 fix for "rejected restores still report
  // success"). No engine is attached in this unit test, so without a
  // dispatcher every restore would read as an engine rejection even though
  // this suite only exercises persistence. A dispatcher that answers nothing
  // (the documented legacy shape `sceneSlice.ts` still treats as success)
  // is enough — the assertions below only care about storage.
  setSceneDispatcher(() => undefined);
});

afterEach(() => {
  setSceneDispatcher(null as unknown as (command: string, payload: unknown) => void);
});

describe('checkpoint manual/AI parity (real persistence)', () => {
  it('AI create+restore persists the same active project as the manual path', async () => {
    // --- AI path -----------------------------------------------------------
    const original = seedProject('v-original');
    const created = await invokeHandler(sceneManagementHandlers, 'create_checkpoint', {
      label: 'pre-change',
    });
    expect(created.result.success).toBe(true);
    const aiCpId = (created.result.result as { checkpointId: string }).checkpointId;

    // Move the active project forward, then restore through the AI handler.
    saveProjectScenes({ ...original, scenes: [{ ...original.scenes[0], name: 'MOVED' }, original.scenes[1]] });
    const aiRestore = await invokeHandler(sceneManagementHandlers, 'restore_checkpoint', {
      checkpointId: aiCpId,
    });
    expect(aiRestore.result.success).toBe(true);
    const aiPersisted = localStorage.getItem(SCENES_STORAGE_KEY);

    // --- Manual path -------------------------------------------------------
    localStorage.clear();
    seedProject('v-original');
    const { store } = createSceneTestStore();
    const cp = await store.getState().createCheckpoint('pre-change');
    expect(cp).not.toBeNull();
    saveProjectScenes({ ...original, scenes: [{ ...original.scenes[0], name: 'MOVED' }, original.scenes[1]] });
    const ok = store.getState().restoreCheckpoint(cp!.id);
    expect(ok).toBe(true);
    const manualPersisted = localStorage.getItem(SCENES_STORAGE_KEY);

    // Both paths restored the same original project, byte-for-byte.
    expect(aiPersisted).toBe(manualPersisted);
    expect(loadProjectScenes()).toEqual(original);
  });

  it('AI-created checkpoints are visible to the manual list action and vice versa', async () => {
    seedProject('shared');
    await invokeHandler(sceneManagementHandlers, 'create_checkpoint', { label: 'from-ai' });

    // The manual store action sees the AI-created checkpoint.
    const { store } = createSceneTestStore();
    const viaStore = store.getState().listCheckpoints();
    expect(viaStore.map((c) => c.label)).toContain('from-ai');

    // A manual checkpoint is visible to the AI list handler.
    await store.getState().createCheckpoint('from-manual');
    const aiList = await invokeHandler(sceneManagementHandlers, 'list_checkpoints');
    const labels = (aiList.result.result as { checkpoints: Array<{ label: string }> }).checkpoints.map(
      (c) => c.label
    );
    expect(labels).toEqual(expect.arrayContaining(['from-ai', 'from-manual']));
    // And the raw store agrees with what the AI handler reported.
    expect(listCheckpoints().map((c) => c.label).sort()).toEqual(labels.sort());
  });

  it('AI delete and manual delete operate on the same checkpoint store (F2 parity)', async () => {
    seedProject('shared');
    // Create three checkpoints through the AI path.
    const a = await invokeHandler(sceneManagementHandlers, 'create_checkpoint', { label: 'A' });
    const b = await invokeHandler(sceneManagementHandlers, 'create_checkpoint', { label: 'B' });
    await invokeHandler(sceneManagementHandlers, 'create_checkpoint', { label: 'C' });
    const aId = (a.result.result as { checkpointId: string }).checkpointId;
    const bId = (b.result.result as { checkpointId: string }).checkpointId;

    // The AI delete_checkpoint handler removes B; the count it reports and the
    // manual store's list both agree B is gone. If the handler used a different
    // store than the Scene Browser button, these would diverge.
    const del = await invokeHandler(sceneManagementHandlers, 'delete_checkpoint', {
      checkpointId: bId,
    });
    expect(del.result.success).toBe(true);
    expect((del.result.result as { count: number }).count).toBe(2);

    const { store } = createSceneTestStore();
    expect(store.getState().listCheckpoints().map((c) => c.label).sort()).toEqual(['A', 'C']);

    // The manual delete path (the deleteCheckpoint action the Trash2 button
    // calls) removes A the same way, and the AI list handler sees the result —
    // one implementation, driven from both sides.
    const remaining = store.getState().deleteCheckpoint(aId);
    expect(remaining.map((c) => c.label)).toEqual(['C']);
    const aiList = await invokeHandler(sceneManagementHandlers, 'list_checkpoints');
    const labels = (aiList.result.result as { checkpoints: Array<{ label: string }> }).checkpoints.map(
      (c) => c.label
    );
    expect(labels).toEqual(['C']);
    expect(listCheckpoints().map((c) => c.label)).toEqual(['C']);
  });

  it('AI delete_checkpoint is a no-op on an unknown ID, like the manual path', async () => {
    seedProject('shared');
    await invokeHandler(sceneManagementHandlers, 'create_checkpoint', { label: 'keep' });
    const del = await invokeHandler(sceneManagementHandlers, 'delete_checkpoint', {
      checkpointId: 'ckpt_does_not_exist',
    });
    expect(del.result.success).toBe(true);
    expect((del.result.result as { count: number }).count).toBe(1);
    expect(listCheckpoints().map((c) => c.label)).toEqual(['keep']);
  });
});
