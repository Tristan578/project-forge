// @vitest-environment jsdom
/**
 * An exported 2D game must carry its project dimension (#10013): the scene
 * file does not, and without `set_project_type` the engine has no 2D camera,
 * so every sprite is invisible. Measured on the real engine with the pinned
 * perf-2d@1 fixture: 2 distinct colours on screen without it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { exportGame } from '@/lib/export/exportEngine';
import { handleTransformEvent } from '@/hooks/events/transformEvents';
import { useEditorStore } from '@/stores/editorStore';
import { exportAsZip } from '@/lib/export/zipExporter';
import type { GetFn, SetFn } from '@/hooks/events/types';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: { getState: vi.fn(), setState: vi.fn(), subscribe: vi.fn() },
}));
vi.mock('@/lib/storage/autoSave', () => ({ setLastExportedScene: vi.fn() }));
vi.mock('@/lib/export/scriptBundler', () => ({ bundleScripts: vi.fn(() => ({ code: '' })) }));
vi.mock('@/lib/export/zipExporter', () => ({ exportAsZip: vi.fn(async () => new Blob(['game'])) }));

function editorWithProjectType(projectType: '2d' | '3d') {
  const editor = {
    autoSaveEnabled: false,
    allScripts: {},
    mobileTouchConfig: null,
    projectType,
    saveScene: vi.fn((id?: string) => {
      handleTransformEvent(
        'SCENE_EXPORTED',
        { requestId: id, name: 'Scene', json: JSON.stringify({ formatVersion: 3, entities: [] }) },
        vi.fn() as SetFn,
        (() => editor) as unknown as GetFn,
      );
    }),
  };
  vi.mocked(useEditorStore.getState).mockReturnValue(editor as unknown as ReturnType<typeof useEditorStore.getState>);
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
});

describe('exportGame passes the project dimension to the exporter', () => {
  it.each(['2d', '3d'] as const)('forwards projectType %s to the ZIP exporter', async (projectType) => {
    editorWithProjectType(projectType);
    await exportGame({ title: 'Game', mode: 'zip', resolution: 'responsive', bgColor: '#000000', includeDebug: false });
    expect(exportAsZip).toHaveBeenCalledTimes(1);
    expect(vi.mocked(exportAsZip).mock.calls[0][2]).toMatchObject({ projectType });
  });
});
