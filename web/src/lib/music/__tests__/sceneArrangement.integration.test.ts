// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/hooks/useEngine', () => ({ setEngineSnapshotProvider: vi.fn() }));
vi.mock('@/lib/analytics/events', () => ({ trackCommandDispatched: vi.fn() }));
vi.mock('@/lib/monitoring/sentry-client', () => ({ addBreadcrumb: vi.fn(), captureException: vi.fn() }));
vi.mock('@/lib/toast', () => ({ showError: vi.fn() }));
vi.mock('@/lib/audio/entityAudioGraph', () => ({ releaseEntityAudio: vi.fn(), resetEntityAudioGraphForScene: vi.fn() }));
vi.mock('@/lib/ai/cachedContext', () => ({ invalidateSceneCache: vi.fn() }));
vi.mock('@/lib/storage/autoSave', () => ({ setLastExportedScene: vi.fn() }));
vi.mock('@/lib/sceneFile', () => ({ saveAutoSave: vi.fn(), CURRENT_FORMAT_VERSION: 3 }));
import { useEditorStore, setCommandDispatcher, getCommandDispatcher } from '@/stores/editorStore';
import { setSceneDispatcher } from '@/stores/slices/sceneSlice';
import { handleTransformEvent } from '@/hooks/events/transformEvents';
import { saveAutoSave } from '@/lib/sceneFile';
import { setLastExportedScene } from '@/lib/storage/autoSave';
import { saveSceneToCloud } from '@/lib/projects/cloudSave';
import { captureActiveScene } from '@/lib/scenes/captureScene';
import { SCENE_EXPORTED_EVENT, type SceneExportedDetail } from '@/lib/engine/sceneExportWire';
import { useMusicArrangementStore, readArrangementFromSceneData } from '../arrangementStore';
import { resetSceneArrangement } from '../sceneArrangement';
import { ARRANGEMENT_SCENE_DATA_KEY } from '../arrangementTypes';

const scene = (name: string, withMusic = true) => JSON.stringify({
  formatVersion: 3, sceneName: name, entities: [],
  ...(withMusic ? { [ARRANGEMENT_SCENE_DATA_KEY]: { version: 1, tempoBpm: 120,
    tracks: [{ id: name, name, muted: false }], clips: [] } } : {}),
});
const music = () => useMusicArrangementStore.getState();
function deliver(type: string, data: Record<string, unknown>) {
  handleTransformEvent(type, data, useEditorStore.setState, useEditorStore.getState);
}
function exported(json = scene('Live', false)) {
  let result!: SceneExportedDetail;
  const listen = (event: Event) => { result = (event as CustomEvent<SceneExportedDetail>).detail; };
  window.addEventListener(SCENE_EXPORTED_EVENT, listen);
  try { deliver('SCENE_EXPORTED', { json, name: 'Live', requestId: 'music-save' }); }
  finally { window.removeEventListener(SCENE_EXPORTED_EVENT, listen); }
  return result;
}

describe('arrangement through the editor dispatch and scene event producer', () => {
  beforeEach(() => {
    vi.useFakeTimers(); vi.clearAllMocks(); sessionStorage.clear();
    resetSceneArrangement();
    useEditorStore.setState({ projectId: null, sceneModified: false, cloudSaveStatus: 'saved', autoSaveEnabled: true, engineMode: 'edit' });
    setCommandDispatcher(vi.fn(() => ({ success: true })));
  });
  afterEach(() => { resetSceneArrangement(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('adopts metadata on confirmed load and clears it for a plain scene', () => {
    music().addTrack('Outgoing');
    useEditorStore.getState().loadScene(scene('Incoming'));
    expect(music().arrangement.tracks[0].name).toBe('Outgoing');
    deliver('SCENE_LOADED', { name: 'Incoming' });
    expect(music().arrangement.tracks[0].name).toBe('Incoming');
    expect(music().canUndo).toBe(false);
    useEditorStore.getState().loadScene(scene('Plain', false));
    deliver('SCENE_LOADED', { name: 'Plain' });
    expect(music().serialize()).toBeNull();
  });

  it.each(['rejected', 'throw'] as const)('preserves accepted pending metadata when a newer load is %s', (failure) => {
    useEditorStore.getState().loadScene(scene('Accepted'));
    setCommandDispatcher(() => { if (failure === 'throw') throw new Error('offline'); return { success: false, error: 'invalid' }; });
    if (failure === 'throw') expect(() => useEditorStore.getState().loadScene(scene('Refused'))).toThrow('offline');
    else useEditorStore.getState().loadScene(scene('Refused'));
    deliver('SCENE_LOADED', { name: 'Accepted' });
    expect(music().arrangement.tracks[0].name).toBe('Accepted');
  });

  it('does not stage a scene without an engine dispatcher', () => {
    useEditorStore.getState().loadScene(scene('Accepted'));
    setSceneDispatcher(null as unknown as Parameters<typeof setSceneDispatcher>[0]);
    useEditorStore.getState().loadScene(scene('Offline'));
    deliver('SCENE_LOADED', { name: 'Accepted' });
    expect(music().arrangement.tracks[0].name).toBe('Accepted');
  });

  it('handles synchronous scene confirmation and new scene clearing', () => {
    setCommandDispatcher(() => { deliver('SCENE_LOADED', { name: 'Sync' }); return { success: true }; });
    useEditorStore.getState().loadScene(scene('Sync'));
    expect(music().arrangement.tracks[0].name).toBe('Sync');
    useEditorStore.getState().newScene();
    expect(music().serialize()).toBeNull();
  });

  it('stages metadata for direct chat/engine dispatches too', () => {
    getCommandDispatcher()!('load_scene', { json: scene('Direct') });
    deliver('SCENE_LOADED', { name: 'Direct' });
    expect(music().arrangement.tracks[0].name).toBe('Direct');
  });

  it('clears outgoing history and pending loads when changing projects', () => {
    music().addTrack('Outgoing');
    useEditorStore.getState().loadScene(scene('Stale'));
    useEditorStore.getState().setProjectId('another-project');
    expect(music().serialize()).toBeNull();
    expect(music().canUndo).toBe(false);
    deliver('SCENE_LOADED', { name: 'Late old project' });
    expect(music().serialize()).toBeNull();
  });

  it('marks edits dirty, debounces export, and suppresses no-op exports', async () => {
    const dispatch = vi.fn(() => ({ success: true })); setCommandDispatcher(dispatch);
    const trackId = music().addTrack('Music')!;
    expect(useEditorStore.getState()).toMatchObject({ sceneModified: true, cloudSaveStatus: 'idle' });
    await vi.runOnlyPendingTimersAsync();
    expect(dispatch).toHaveBeenCalledWith('export_scene', {});
    dispatch.mockClear(); music().renameTrack(trackId, 'Music');
    await vi.runOnlyPendingTimersAsync(); expect(dispatch).not.toHaveBeenCalled();
  });

  it('cancels outgoing edit autosave when a load is confirmed', async () => {
    const dispatch = vi.fn(() => ({ success: true })); setCommandDispatcher(dispatch);
    music().addTrack('Outgoing'); useEditorStore.getState().newScene();
    deliver('SCENE_LOADED', { name: 'Empty' }); dispatch.mockClear();
    await vi.runOnlyPendingTimersAsync(); expect(dispatch).not.toHaveBeenCalled();
    expect(useEditorStore.getState().sceneModified).toBe(false);
  });

  it('puts the same metadata into download/capture events, autosave cache and recovery', async () => {
    music().addTrack('Saved music');
    const expected = music().serialize();
    const capture = captureActiveScene(() => { exported(); return true; });
    const result = await capture;
    expect(result.status).toBe('captured');
    if (result.status === 'captured') expect(readArrangementFromSceneData(result.data)).toEqual(expected);
    const detail = exported();
    expect(readArrangementFromSceneData(JSON.parse(detail.json))).toEqual(expected);
    expect(detail.requestId).toBe('music-save');
    expect(saveAutoSave).toHaveBeenLastCalledWith(detail.json, 'Live');
    expect(setLastExportedScene).toHaveBeenLastCalledWith(detail.json, 'Live');
    expect(sessionStorage.getItem('forge:scene-last-json')).toBe(detail.json);
  });

  it('retains enriched metadata in cloud saves when no override is supplied', async () => {
    music().addTrack('Cloud music');
    const detail = exported();
    const fetcher = vi.fn(async () => ({ ok: true })); vi.stubGlobal('fetch', fetcher);
    expect((await saveSceneToCloud('project', 'Cloud music', detail.json)).ok).toBe(true);
    const body = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(readArrangementFromSceneData(body.sceneData)).toEqual(music().serialize());
  });

  it('removes stale serialized metadata after clearing the arrangement', () => {
    expect(JSON.parse(exported(scene('Stale')).json)).not.toHaveProperty(ARRANGEMENT_SCENE_DATA_KEY);
  });
});
