// @vitest-environment jsdom
/** Both AI entry points advertise recovery; UI and AI share one real action. */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { sceneManagementHandlers } from '../sceneManagementHandlers';
import { createSceneTestStore } from '@/stores/slices/__tests__/sceneSliceTestStore';
import { setSceneDispatcher } from '@/stores/slices/sceneSlice';
import { saveProjectScenes, loadProjectScenes, listCheckpoints } from '@/lib/scenes/sceneManager';
import { attachCheckpointEngine, projectFixture, sceneFixture } from '@/lib/scenes/__tests__/sceneFixture';
import { createMockStore } from './handlerTestUtils';
import { getChatTools } from '@/lib/chat/tools';
import { AGENT_TOOLS } from '@/lib/ai/spawnforgeAgent';

let store: ReturnType<typeof createSceneTestStore>['store'];
let engine: ReturnType<typeof attachCheckpointEngine>;
function invoke(name: string, args: Record<string, unknown> = {}) {
  return sceneManagementHandlers[name](args, {
    store: createMockStore({ ...store.getState() }),
    dispatchCommand: () => {},
  });
}

beforeEach(() => {
  localStorage.clear();
  store = createSceneTestStore().store;
  engine = attachCheckpointEngine(sceneFixture('Original'));
  saveProjectScenes(projectFixture('Original'));
});
afterEach(() => setSceneDispatcher(null));

describe('checkpoint UI and AI parity', () => {
  it('offers checkpoint listing on both AI tool builders', () => {
    expect(getChatTools().map((tool) => tool.name)).toContain('list_checkpoints');
    expect(Object.keys(AGENT_TOOLS)).toContain('list_checkpoints');
  });

  it('creates and restores the same project through AI and manual controls', async () => {
    const created = await invoke('create_checkpoint', { label: 'Before change' });
    expect(created.success).toBe(true);
    const id = (created.result as { checkpointId: string }).checkpointId;
    expect(store.getState().listCheckpoints()[0].id).toBe(id);
    saveProjectScenes(projectFixture('Later'));
    engine.setScene(sceneFixture('Later'));
    expect((await invoke('restore_checkpoint', { checkpointId: id })).success).toBe(true);
    expect(loadProjectScenes().scenes[0].data?.metadata?.name).toBe('Original');
    expect(engine.getScene().metadata?.name).toBe('Original');

    const manual = await store.getState().createCheckpoint('Manual');
    const listed = await invoke('list_checkpoints');
    expect((listed.result as { checkpoints: Array<{ id: string }> }).checkpoints.map((cp) => cp.id)).toContain(manual!.id);
  });

  it('reports a failed applied-scene check through the AI without replacing storage', async () => {
    const checkpoint = await store.getState().createCheckpoint('Keep');
    saveProjectScenes(projectFixture('Later'));
    engine.setScene(sceneFixture('Later live'));
    engine.setMode('wrong');
    expect((await invoke('restore_checkpoint', { checkpointId: checkpoint!.id })).success).toBe(false);
    expect(loadProjectScenes().scenes[0].name).toBe('Later');
    expect(engine.getScene().metadata?.name).toBe('Later live');
  });

  // #10202 review, m7: through the AI tool, a restore load the engine THREW on
  // (as the editor's dispatcher reports it: `threw: true`) fails the restore
  // and leaves the THREW save lockout standing — not the clean-refusal one —
  // with storage untouched. The recovery of the prior scene fails its
  // readback here so the lockout is observable after the tool returns; with
  // a confirmed recovery it is cleared, since `prior` was captured before the
  // throw.
  it('reports a thrown restore load through the AI with the THREW save lockout, without replacing storage', async () => {
    const checkpoint = await store.getState().createCheckpoint('Keep');
    saveProjectScenes(projectFixture('Later'));
    engine.setScene(sceneFixture('Later live'));
    engine.setModes(['threw', 'wrong']);

    const result = await invoke('restore_checkpoint', { checkpointId: checkpoint!.id });

    expect(result.success).toBe(false);
    expect(loadProjectScenes().scenes[0].name).toBe('Later');
    expect(store.getState().sceneLoadError?.reason).toContain('the engine failed while loading it');
    expect(store.getState().sceneLoadError?.reason).not.toContain('the engine refused to load it');
    // The lockout gates the AI export too.
    expect((await invoke('export_scene')).success).toBe(false);
  });

  it('deletes through either surface and uses the current project namespace', async () => {
    const first = await store.getState().createCheckpoint('First');
    const second = await store.getState().createCheckpoint('Second');
    expect((await invoke('delete_checkpoint', { checkpointId: first!.id })).success).toBe(true);
    expect(store.getState().listCheckpoints().map((cp) => cp.id)).toEqual([second!.id]);
    store.getState().deleteCheckpoint(second!.id);
    expect((await invoke('list_checkpoints')).result).toEqual({ checkpoints: [], count: 0 });
    store.getState().setProjectId('Other');
    expect(listCheckpoints('Other')).toEqual([]);
  });
});
