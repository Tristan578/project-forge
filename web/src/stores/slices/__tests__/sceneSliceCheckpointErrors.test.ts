// @vitest-environment jsdom
/** Recovery must confirm engine application before replacing a valid save. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createSceneTestStore } from './sceneSliceTestStore';
import { setSceneDispatcher } from '../sceneSlice';
import { saveProjectScenes, loadProjectScenes, createCheckpoint, listCheckpoints } from '@/lib/scenes/sceneManager';
import { attachCheckpointEngine, projectFixture, sceneFixture } from '@/lib/scenes/__tests__/sceneFixture';

describe('checkpoint recovery transaction', () => {
  let store: ReturnType<typeof createSceneTestStore>['store'];
  let engine: ReturnType<typeof attachCheckpointEngine>;
  beforeEach(() => {
    localStorage.clear();
    store = createSceneTestStore().store;
    engine = attachCheckpointEngine(sceneFixture('Unsaved live work'));
    saveProjectScenes(projectFixture('Previous save'));
  });
  afterEach(() => {
    setSceneDispatcher(null);
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('preserves the active save when checkpoint storage exceeds quota', async () => {
    const before = localStorage.getItem('forge-project-scenes');
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Full', 'QuotaExceededError'); });
    await expect(store.getState().createCheckpoint('Before changes')).resolves.toBeNull();
    expect(localStorage.getItem('forge-project-scenes')).toBe(before);
    expect(store.getState().checkpointError).toContain('Full');
  });

  it('does not persist or claim success on the synchronous queued response', async () => {
    const cp = createCheckpoint(projectFixture('Recovered')).checkpoint;
    const pending = store.getState().restoreCheckpoint(cp.id);
    expect(loadProjectScenes().scenes[0].name).toBe('Previous save');
    expect(store.getState().checkpointBusy).toBe(true);
    await expect(pending).resolves.toBe(true);
    expect(loadProjectScenes().scenes[0].name).toBe('Recovered');
    expect(engine.getScene().metadata?.name).toBe('Recovered');
  });

  it('preserves live state without a needless rollback load after an explicit rejection', async () => {
    const cp = createCheckpoint(projectFixture('Recovered')).checkpoint;
    engine.setMode('reject');
    await expect(store.getState().restoreCheckpoint(cp.id)).resolves.toBe(false);
    expect(loadProjectScenes().scenes[0].name).toBe('Previous save');
    expect(engine.getScene().metadata?.name).toBe('Unsaved live work');
    expect(engine.dispatch.mock.calls.filter(([command]) => command === 'load_scene')).toHaveLength(1);
  });

  it('times out a queued load that never applies and restores the prior live scene', async () => {
    vi.useFakeTimers();
    const cp = createCheckpoint(projectFixture('Recovered')).checkpoint;
    engine.setMode('silent');
    const pending = store.getState().restoreCheckpoint(cp.id);
    await vi.advanceTimersByTimeAsync(10000);
    await expect(pending).resolves.toBe(false);
    expect(loadProjectScenes().scenes[0].name).toBe('Previous save');
    expect(engine.getScene().metadata?.name).toBe('Unsaved live work');
  });

  it('rejects an acknowledged load whose readback contains a different scene', async () => {
    const cp = createCheckpoint(projectFixture('Recovered')).checkpoint;
    engine.setMode('wrong');
    await expect(store.getState().restoreCheckpoint(cp.id)).resolves.toBe(false);
    expect(loadProjectScenes().scenes[0].name).toBe('Previous save');
    expect(engine.getScene().metadata?.name).toBe('Unsaved live work');
  });

  it('rolls back live work if saving the confirmed restore fails', async () => {
    const cp = createCheckpoint(projectFixture('Recovered')).checkpoint;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Full', 'QuotaExceededError'); });
    await expect(store.getState().restoreCheckpoint(cp.id)).resolves.toBe(false);
    expect(loadProjectScenes().scenes[0].name).toBe('Previous save');
    expect(engine.getScene().metadata?.name).toBe('Unsaved live work');
    expect(store.getState().activeSceneId).toBeNull();
  });

  it('refuses creation and restore when no engine is attached, including null active scene data', async () => {
    const project = projectFixture('Empty');
    project.scenes[0].data = null;
    const cp = createCheckpoint(project).checkpoint;
    setSceneDispatcher(null);
    await expect(store.getState().createCheckpoint()).resolves.toBeNull();
    await expect(store.getState().restoreCheckpoint(cp.id)).resolves.toBe(false);
    expect(localStorage.getItem('forge-project-scenes')).toContain('Previous save');
  });

  it('restores null scene data as a confirmed empty scene', async () => {
    const project = projectFixture('Empty');
    project.scenes[0].data = null;
    const cp = createCheckpoint(project).checkpoint;
    await expect(store.getState().restoreCheckpoint(cp.id)).resolves.toBe(true);
    expect(engine.getScene().entities).toEqual([]);
    expect(engine.getScene().metadata?.name).toBe('Empty');
  });

  it('does not roll back over a newer same-project scene load', async () => {
    const cp = createCheckpoint(projectFixture('Recovered')).checkpoint;
    engine.setMode('silent');
    const pending = store.getState().restoreCheckpoint(cp.id);
    await Promise.resolve();
    await Promise.resolve();
    store.getState().loadScene(JSON.stringify(sceneFixture('Newer user load')));
    await expect(pending).resolves.toBe(false);
    expect(engine.getScene().metadata?.name).toBe('Newer user load');
    expect(engine.dispatch.mock.calls.filter(([command]) => command === 'load_scene')).toHaveLength(2);
    expect(loadProjectScenes().scenes[0].name).toBe('Previous save');
  });

  it('keeps recovery active when a competing scene load is explicitly rejected', async () => {
    const cp = createCheckpoint(projectFixture('Recovered')).checkpoint;
    const pending = store.getState().restoreCheckpoint(cp.id);
    engine.setMode('reject');
    expect(store.getState().loadScene(JSON.stringify(sceneFixture('Rejected scene')))).toBe(false);
    await expect(pending).resolves.toBe(true);
    expect(engine.getScene().metadata?.name).toBe('Recovered');
    expect(loadProjectScenes().scenes[0].name).toBe('Recovered');
    expect(store.getState().checkpointError).toBeNull();
  });

  it.each(['createNewScene', 'deleteScene', 'duplicateScene', 'switchScene'] as const)(
    '%s leaves scene storage and the browser mirror unchanged while disconnected', async (action) => {
    store.getState().createNewScene('Second');
    const second = store.getState().scenes.find((scene) => scene.name === 'Second')!;
    const before = localStorage.getItem('forge-project-scenes');
    const scenes = store.getState().scenes;
    const activeId = store.getState().activeSceneId;
    setSceneDispatcher(null);
    await expect((async () => store.getState()[action](second.id))()).resolves.toBeUndefined();
    expect(localStorage.getItem('forge-project-scenes')).toBe(before);
    expect(store.getState().scenes).toBe(scenes);
    expect(store.getState().activeSceneId).toBe(activeId);
  });

  it.each(['switchScene', 'duplicateScene'] as const)(
    'preserves storage when the engine disconnects during %s capture', async (action) => {
      store.getState().createNewScene('Second');
      const second = store.getState().scenes.find((scene) => scene.name === 'Second')!;
      const before = localStorage.getItem('forge-project-scenes');
      const scenes = store.getState().scenes;
      const pending = store.getState()[action](second.id);
      setSceneDispatcher(null);
      await expect(pending).resolves.toBeUndefined();
      expect(localStorage.getItem('forge-project-scenes')).toBe(before);
      expect(store.getState().scenes).toBe(scenes);
    },
  );

  it('does not attach an export to the project opened while capture was pending', async () => {
    store.getState().setProjectId('A');
    const pending = store.getState().createCheckpoint('A only');
    store.getState().setProjectId('B');
    await expect(pending).resolves.toBeNull();
    expect(listCheckpoints('A')).toEqual([]);
    expect(listCheckpoints('B')).toEqual([]);
  });

  it('detects an A to B to A navigation during capture', async () => {
    store.getState().setProjectId('A');
    const pending = store.getState().createCheckpoint();
    store.getState().setProjectId('B');
    store.getState().setProjectId('A');
    await expect(pending).resolves.toBeNull();
    expect(listCheckpoints('A')).toEqual([]);
  });

  it('prevents a second checkpoint operation while recovery is pending', async () => {
    const pending = store.getState().createCheckpoint('First');
    await expect(store.getState().createCheckpoint('Second')).resolves.toBeNull();
    expect(await pending).not.toBeNull();
    expect(listCheckpoints().map((cp) => cp.label)).toEqual(['First']);
  });

  it('does not mix saved scenes or checkpoints across projects', async () => {
    saveProjectScenes(projectFixture('Other project'), 'B');
    store.getState().setProjectId('A');
    const cp = await store.getState().createCheckpoint('Only A');
    expect(cp?.projectId).toBe('A');
    expect(cp?.snapshot.scenes).toHaveLength(1);
    expect(cp?.snapshot.scenes[0].data?.metadata?.name).toBe('Unsaved live work');
    store.getState().setProjectId('B');
    expect(store.getState().listCheckpoints()).toEqual([]);
    await expect(store.getState().restoreCheckpoint(cp!.id)).resolves.toBe(false);
    store.getState().deleteCheckpoint(cp!.id);
    expect(listCheckpoints('A')).toHaveLength(1);
    expect(loadProjectScenes('B').scenes[0].name).toBe('Other project');
  });

  it('reports delete failures while preserving the recovery point', () => {
    const cp = createCheckpoint(projectFixture('Recoverable')).checkpoint;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage disabled'); });
    expect(store.getState().deleteCheckpoint(cp.id).map((entry) => entry.id)).toContain(cp.id);
    expect(store.getState().checkpointError).toContain('Storage disabled');
  });
});
