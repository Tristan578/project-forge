// @vitest-environment jsdom
/**
 * An exported 2D game must carry its project dimension (#10013): the scene
 * file does not, and without `set_project_type` the engine has no 2D camera,
 * so every sprite is invisible. Measured on the real engine with the pinned
 * perf-2d@1 fixture: 2 distinct colours on screen without it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

/**
 * The single-HTML path does not go through `exportAsZip`: `exportGame` hands
 * `store.projectType` to the real `generateGameHTML`, which emits the switch
 * into the page. Asserted on the page itself, not on a spy, so a dropped
 * forward and a template that stops honouring it both go red.
 */
describe('exportGame carries the project dimension into a single-HTML game', () => {
  const SWITCH_TO_2D = "handle_command('set_project_type', { projectType: '2d' });";

  beforeEach(() => {
    // fetchWasmForInlining refuses to build the page without at least one
    // engine variant; any bytes will do, the page is inspected as text.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('forge_engine.js')) return { ok: true, text: async () => '// glue' };
        if (url.endsWith('forge_engine_bg.wasm')) return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) };
        return { ok: false };
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function singleHtml(): Promise<string> {
    const blob = await exportGame({
      title: 'Game',
      mode: 'single-html',
      resolution: 'responsive',
      bgColor: '#000000',
      includeDebug: false,
    });
    expect(exportAsZip).not.toHaveBeenCalled();
    expect(blob.type).toBe('text/html');
    return blob.text();
  }

  it('a 2D project boots the exported engine into 2D after the scene loads', async () => {
    editorWithProjectType('2d');
    const html = await singleHtml();
    expect(html.split(SWITCH_TO_2D)).toHaveLength(2);
    expect(html.indexOf(SWITCH_TO_2D)).toBeGreaterThan(html.indexOf('await __forgeLoadScene(handle_command'));
  });

  it('a 3D project exports the same boot sequence with no project-type switch', async () => {
    editorWithProjectType('3d');
    const html = await singleHtml();
    // The page is the real template, not an empty string: it initialises the
    // engine and loads the scene, and only the 2D switch is absent.
    expect(html).toContain("init_engine('game-canvas');");
    expect(html).toContain('await __forgeLoadScene(handle_command');
    expect(html).not.toContain('set_project_type');
  });
});
