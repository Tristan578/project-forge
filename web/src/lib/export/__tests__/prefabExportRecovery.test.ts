// @vitest-environment jsdom
/** A playable export shares its engine response with editor autosave and recovery. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { exportGame } from '@/lib/export/exportEngine';
import { handleTransformEvent } from '@/hooks/events/transformEvents';
import { useEditorStore } from '@/stores/editorStore';
import { setLastExportedScene } from '@/lib/storage/autoSave';
import { exportAsZip } from '@/lib/export/zipExporter';
import {
  addNestedPrefab, createPrefabInstance, deletePrefab, loadPrefabInstances,
  savePrefab, takeStagedPrefabDataForExport, updatePrefab,
} from '@/lib/prefabs/prefabStore';
import type { GetFn, SetFn } from '@/hooks/events/types';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: { getState: vi.fn(), setState: vi.fn(), subscribe: vi.fn() },
}));
vi.mock('@/lib/storage/autoSave', () => ({ setLastExportedScene: vi.fn() }));
vi.mock('@/lib/export/scriptBundler', () => ({ bundleScripts: vi.fn(() => ({ code: '' })) }));
vi.mock('@/lib/export/zipExporter', () => ({ exportAsZip: vi.fn(async () => new Blob(['game'])) }));

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.clearAllMocks();
});

describe('game export and editor recovery isolation', () => {
  it('preserves requested links and definitions in recovery while stripping only the playable bundle', async () => {
    const snapshot = {
      entityType: 'cube', name: 'Original',
      transform: { position: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0] as [number, number, number], scale: [1, 1, 1] as [number, number, number] },
    };
    const source = savePrefab('Parent', 'test', '', snapshot);
    const child = savePrefab('Child', 'test', '', snapshot);
    addNestedPrefab(source.id, child.id);
    createPrefabInstance(source.id, { name: 'Override' }, 'entity-1');
    const expectedInstances = loadPrefabInstances();
    let requestId: string | undefined;
    const editor = {
      autoSaveEnabled: false, allScripts: {}, mobileTouchConfig: null,
      saveScene: vi.fn((id?: string) => {
        requestId = id;
        // The library changes before the engine answers the export request.
        updatePrefab(source.id, { ...snapshot, name: 'Changed after request' });
        deletePrefab(child.id);
        handleTransformEvent('SCENE_EXPORTED', {
          requestId: id, name: 'Scene', json: JSON.stringify({ formatVersion: 1, sceneName: 'Scene', entities: [{ id: 'entity-1' }] }),
        }, vi.fn() as SetFn, (() => editor) as unknown as GetFn);
      }),
    };
    vi.mocked(useEditorStore.getState).mockReturnValue(editor as unknown as ReturnType<typeof useEditorStore.getState>);
    await exportGame({ title: 'Game', mode: 'zip', resolution: 'responsive', bgColor: '#000000', includeDebug: false });

    expect(exportAsZip).toHaveBeenCalledTimes(1);
    const game = vi.mocked(exportAsZip).mock.calls[0][0] as Record<string, unknown>;
    expect(game.entities).toEqual([{ id: 'entity-1' }]);
    expect(game).not.toHaveProperty('prefabInstances');
    expect(game).not.toHaveProperty('prefabDefinitions');

    const recovery = JSON.parse(sessionStorage.getItem('forge:scene-last-json')!);
    expect(recovery.prefabInstances).toEqual(expectedInstances);
    expect(recovery.prefabDefinitions.map((prefab: { id: string }) => prefab.id)).toEqual([source.id, child.id]);
    expect(recovery.prefabDefinitions[0].snapshot.name).toBe('Original');
    expect(recovery.prefabDefinitions[0].children[0].prefabId).toBe(child.id);
    expect(setLastExportedScene).toHaveBeenCalledWith(JSON.stringify(recovery), 'Scene');
    expect(takeStagedPrefabDataForExport(requestId)).toBeUndefined();
  });
});
