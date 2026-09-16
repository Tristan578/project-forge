// @vitest-environment jsdom
/** Recovery must confirm engine application before replacing a valid save. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createSceneTestStore } from './sceneSliceTestStore';
import { setSceneDispatcher } from '../sceneSlice';
import { saveProjectScenes, loadProjectScenes, createCheckpoint, listCheckpoints } from '@/lib/scenes/sceneManager';
import { attachCheckpointEngine, projectFixture, sceneFixture } from '@/lib/scenes/__tests__/sceneFixture';
import { useMusicArrangementStore } from '@/lib/music/arrangementStore';
import { loadPrefabInstances, savePrefabInstancesToStorage } from '@/lib/prefabs/prefabStore';
import type { PrefabInstance } from '@/lib/prefabs/prefabInstance';

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

  it('captures the live prefab registry into a checkpoint and reinstalls it on restore (scene.FR-1 N1 / #10056)', async () => {
    // Without the fold in `createCheckpoint`, the checkpoint records the engine
    // export alone — no `prefabInstances` — and restore silently discards every
    // linked instance. Without the registry install in `restoreCheckpoint`, the
    // outgoing (empty) registry stays installed over the restored checkpoint and
    // the next save folds it onto the wrong scene. A built-in source keeps the
    // instance resolvable without seeding the local library. `name` is a
    // whitelisted override field, so it survives the sanitize round trip.
    const seeded: PrefabInstance[] = [
      { instanceId: 'inst_1', prefabId: 'builtin_physics_crate', overrides: { name: 'Crate A' } },
    ];
    savePrefabInstancesToStorage(seeded);

    const checkpoint = await store.getState().createCheckpoint('With prefab links');
    expect(checkpoint).not.toBeNull();

    // The checkpoint's stored scene carries the linked instances (createCheckpoint fold).
    const stored = listCheckpoints().find((c) => c.id === checkpoint!.id)!;
    expect(stored.snapshot.scenes[0].data?.prefabInstances).toEqual(seeded);

    // Loading a different scene empties the live registry (the BUG-1 setup).
    expect(store.getState().loadScene(JSON.stringify(sceneFixture('Other scene')))).toBe(true);
    expect(loadPrefabInstances()).toEqual([]);

    // Restore reinstalls the checkpoint's registry rather than leaving the
    // emptied one over the restored scene.
    await expect(store.getState().restoreCheckpoint(checkpoint!.id)).resolves.toBe(true);
    expect(loadPrefabInstances()).toEqual(seeded);
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

  // #10058: a checkpoint capture never carries a music arrangement, so a
  // successful restore used to leave whatever arrangement the scene being
  // REPLACED had — stale tracks/clips from before the restore.
  it('clears a stale music arrangement on a successful checkpoint restore', async () => {
    useMusicArrangementStore.getState().addTrack('Stale');
    expect(useMusicArrangementStore.getState().arrangement.tracks).toHaveLength(1);

    const cp = createCheckpoint(projectFixture('Recovered')).checkpoint;
    await expect(store.getState().restoreCheckpoint(cp.id)).resolves.toBe(true);

    expect(useMusicArrangementStore.getState().arrangement.tracks).toHaveLength(0);
  });

  /** True once `export_scene` has gone out for this correlation id. */
  const exported = (requestId: string) => engine.dispatch.mock.calls.some(
    ([command, payload]) => command === 'export_scene' && (payload as { requestId?: string }).requestId === requestId,
  );

  it('a successful restoreCheckpoint clears sceneLoadError', async () => {
    // Restoring a checkpoint is a recovery route OUT of a rejected load, and
    // `restoreCheckpoint` applies its scene through `dispatchSceneLoad`
    // directly — bypassing every clear that `loadScene`, `newScene` and
    // `loadTemplate` own. Without the clear the editor stays permanently
    // unsavable over a correctly restored scene (#10056).
    const cp = createCheckpoint(projectFixture('Recovered')).checkpoint;
    engine.setMode('reject');
    expect(store.getState().loadScene(JSON.stringify(sceneFixture('Refused scene')))).toBe(false);
    expect(store.getState().sceneLoadError).not.toBeNull();

    await expect(store.getState().restoreCheckpoint(cp.id)).resolves.toBe(true);

    expect(store.getState().sceneLoadError).toBeNull();
    expect(engine.getScene().metadata?.name).toBe('Recovered');
    // The consequence the field actually gates: saving works again.
    store.getState().saveScene('after-restore');
    expect(exported('after-restore')).toBe(true);
  });

  it('a rejected restoreCheckpoint keeps it set with the engine reason', async () => {
    const cp = createCheckpoint(projectFixture('Recovered')).checkpoint;
    engine.setMode('reject');

    await expect(store.getState().restoreCheckpoint(cp.id)).resolves.toBe(false);

    // The engine never adopted the checkpoint, so what it holds is not this
    // project's restored scene and the save lockout must stand — the same
    // reason `loadScene` records on its own rejection branch.
    expect(store.getState().sceneLoadError).toEqual({
      reason: expect.stringContaining('the engine refused to load it'),
      at: expect.any(Number),
    });
    store.getState().saveScene('after-refused-restore');
    expect(exported('after-refused-restore')).toBe(false);
  });

  it('keeps the save lockout set when recovering the prior scene from a THREW lockout (#10079, finding 4)', async () => {
    const cp = createCheckpoint(projectFixture('Recovered')).checkpoint;

    // Raise an ENGINE_LOAD_THREW lockout with a dispatcher that THROWS on
    // load_scene — a throw, unlike a clean rejection, can have despawned the
    // outgoing scene mid-apply, so the `prior` capture restoreCheckpoint takes
    // below is made from a possibly-wrecked viewport.
    setSceneDispatcher((command: string) => {
      if (command === 'validate_scene') return { success: true };
      if (command === 'load_scene') throw new Error('engine despawned mid-apply');
      return { success: true };
    });
    expect(() => store.getState().loadScene(JSON.stringify(sceneFixture('Wrecking load')))).toThrow();
    expect(store.getState().sceneLoadError?.reason).toContain('the engine failed while loading it');

    // Reattach the confirming engine and make the checkpoint restore FAIL its
    // readback ('wrong'), so the recovery branch runs and re-applies `prior`.
    setSceneDispatcher(engine.dispatch);
    engine.dispatch.mockClear();
    const previousSave = localStorage.getItem('forge-project-scenes');
    engine.setMode('wrong');

    await expect(store.getState().restoreCheckpoint(cp.id)).resolves.toBe(false);
    const loads = engine.dispatch.mock.calls.filter(([command]) => command === 'load_scene');
    expect(loads.map(([, payload]) => JSON.parse((payload as { json: string }).json))).toEqual([
      projectFixture('Recovered').scenes[0].data, sceneFixture('Unsaved live work'),
    ]);
    expect(engine.getScene()).toEqual(sceneFixture('Unsaved live work'));
    expect(localStorage.getItem('forge-project-scenes')).toBe(previousSave);

    // The recovery re-applied and SCENE_LOADED-confirmed `prior`, but that
    // capture came from a viewport the throw may have wrecked. Confirming
    // SCENE_LOADED for it does NOT make it trustworthy, so the lockout must
    // STAND rather than be cleared over it — otherwise the next save writes the
    // wreckage over the stored scene, the very overwrite #10056 prevents.
    expect(store.getState().sceneLoadError).not.toBeNull();
    expect(store.getState().sceneLoadError?.reason).toContain('the engine failed while loading it');
    // The consequence the lockout gates: saving still refuses.
    store.getState().saveScene('after-untrusted-recovery');
    expect(exported('after-untrusted-recovery')).toBe(false);
  });

  it('preserves throw provenance across a rejected restore and a later failed recovery retry', async () => {
    const cp = createCheckpoint(projectFixture('Recovered')).checkpoint;
    const saved = localStorage.getItem('forge-project-scenes');
    const thrown = new Error('engine despawned mid-apply');
    setSceneDispatcher((command) => {
      if (command === 'load_scene') throw thrown;
      return { success: true };
    });
    expect(() => store.getState().loadScene(JSON.stringify(sceneFixture('Wrecking load')))).toThrow(thrown);
    const lockout = store.getState().sceneLoadError;
    setSceneDispatcher(engine.dispatch);
    engine.setMode('reject');
    await expect(store.getState().restoreCheckpoint(cp.id)).resolves.toBe(false);
    expect(store.getState().sceneLoadError).toEqual(lockout);
    engine.dispatch.mockClear();
    engine.setMode('wrong');
    await expect(store.getState().restoreCheckpoint(cp.id)).resolves.toBe(false);
    const loads = engine.dispatch.mock.calls.filter(([command]) => command === 'load_scene');
    expect(loads.map(([, payload]) => JSON.parse((payload as { json: string }).json))).toEqual([
      projectFixture('Recovered').scenes[0].data,
      sceneFixture('Unsaved live work'),
    ]);
    expect(engine.getScene()).toEqual(sceneFixture('Unsaved live work'));
    expect(localStorage.getItem('forge-project-scenes')).toBe(saved);
    expect(store.getState().sceneLoadError).toEqual(lockout);
    store.getState().saveScene('after-repeated-untrusted-recovery');
    expect(exported('after-repeated-untrusted-recovery')).toBe(false);
    // A confirmed replacement is still a recovery route out of the lockout.
    await expect(store.getState().restoreCheckpoint(cp.id)).resolves.toBe(true);
    expect(store.getState().sceneLoadError).toBeNull();
    expect(engine.getScene().metadata?.name).toBe('Recovered');
  });

  it('clears a clean-rejection lockout after confirming recovery of the trusted prior capture', async () => {
    const cp = createCheckpoint(projectFixture('Recovered')).checkpoint;
    const saved = localStorage.getItem('forge-project-scenes');
    engine.setMode('reject');
    expect(store.getState().loadScene(JSON.stringify(sceneFixture('Refused load')))).toBe(false);
    expect(store.getState().sceneLoadError?.reason).toContain('the engine refused to load it');
    engine.dispatch.mockClear();
    engine.setMode('wrong');
    await expect(store.getState().restoreCheckpoint(cp.id)).resolves.toBe(false);
    const loads = engine.dispatch.mock.calls.filter(([command]) => command === 'load_scene');
    expect(loads.map(([, payload]) => JSON.parse((payload as { json: string }).json))).toEqual([
      projectFixture('Recovered').scenes[0].data,
      sceneFixture('Unsaved live work'),
    ]);
    expect(engine.getScene()).toEqual(sceneFixture('Unsaved live work'));
    expect(localStorage.getItem('forge-project-scenes')).toBe(saved);
    expect(store.getState().sceneLoadError).toBeNull();
    store.getState().saveScene('after-trusted-prior-recovery');
    expect(exported('after-trusted-prior-recovery')).toBe(true);
  });

  // The rollback on a rejected restore must NOT clear the arrangement: `prior`
  // is the scene that was already active — and whose arrangement is still
  // correctly in the store — before the restore attempt, so re-syncing on
  // rollback would incorrectly wipe it out (#10058).
  it('does not clear the live music arrangement when a rejected restore rolls back', async () => {
    useMusicArrangementStore.getState().addTrack('Live');
    const cp = createCheckpoint(projectFixture('Recovered')).checkpoint;
    engine.setMode('reject');

    await expect(store.getState().restoreCheckpoint(cp.id)).resolves.toBe(false);

    expect(useMusicArrangementStore.getState().arrangement.tracks).toHaveLength(1);
    expect(useMusicArrangementStore.getState().arrangement.tracks[0].name).toBe('Live');
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

  it('does not clear sceneLoadError on a merely-accepted dispatch — only once SCENE_LOADED confirms it (Sentry)', async () => {
    // `dispatchSceneLoad` reports "accepted" the instant the engine does not
    // immediately refuse — that is NOT the same fact as SCENE_LOADED
    // confirming the engine actually applied the scene. `silent` mode accepts
    // synchronously and then never fires SCENE_LOADED, so it isolates exactly
    // that gap: if the lockout cleared on acceptance alone, a manual save could
    // slip through here against a viewport that has not caught up yet.
    vi.useFakeTimers();
    const cp = createCheckpoint(projectFixture('Recovered')).checkpoint;
    engine.setMode('reject');
    expect(store.getState().loadScene(JSON.stringify(sceneFixture('Refused scene')))).toBe(false);
    expect(store.getState().sceneLoadError).not.toBeNull();

    engine.setMode('silent');
    const pending = store.getState().restoreCheckpoint(cp.id);
    // Long enough to flush the capture round trip and the accepted dispatch,
    // short of the 10s SCENE_LOADED timeout applyCheckpointScene enforces.
    await vi.advanceTimersByTimeAsync(1000);
    expect(store.getState().sceneLoadError).not.toBeNull();
    expect(store.getState().checkpointBusy).toBe(true);

    await vi.advanceTimersByTimeAsync(10000);
    await expect(pending).resolves.toBe(false);
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
