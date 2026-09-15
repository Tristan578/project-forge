/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@/test/utils/componentTestUtils';
import { SceneToolbar } from '../SceneToolbar';
import { SCENE_EXPORTED_EVENT, type SceneExportedDetail } from '@/lib/engine/sceneExportWire';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(() => ({})),
}));

vi.mock('lucide-react', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('lucide-react');
  return Object.fromEntries(Object.keys(actual).map(k => [k, () => null]));
});

vi.mock('@/components/editor/ExportDialog', () => ({
  ExportDialog: () => null,
}));

vi.mock('@/components/editor/SceneBrowser', () => ({
  SceneBrowser: () => null,
}));

vi.mock('@/lib/sceneFile', () => ({
  downloadSceneFile: vi.fn(),
  openSceneFilePicker: vi.fn(),
}));

// scene.FR-1 N1: the toolbar folds the live prefab-instance registry into the
// exported scene JSON before persisting. Mock the registry so a test can seed
// it; default empty keeps the correlation tests byte-identical.
const mockLoadPrefabInstances = vi.fn<() => unknown[]>(() => []);
vi.mock('@/lib/prefabs/prefabStore', () => ({
  loadPrefabInstances: () => mockLoadPrefabInstances(),
}));

// Mocked so the cloud-save branch is exercised without a real fetch, and so a
// test can read back the JSON the toolbar handed to the PUT.
const mockSaveSceneToCloud = vi.fn(async (..._a: unknown[]) => ({ ok: true, savedAt: '2026-01-01T00:00:00Z' }));
vi.mock('@/lib/projects/cloudSave', () => ({
  saveSceneToCloud: (...a: unknown[]) => mockSaveSceneToCloud(...a),
}));

import { useEditorStore } from '@/stores/editorStore';
import { downloadSceneFile } from '@/lib/sceneFile';

function mockEditorStore(overrides: Record<string, unknown> = {}) {
  const state: Record<string, unknown> = {
    sceneName: 'My Scene',
    sceneModified: false,
    saveScene: vi.fn(),
    loadScene: vi.fn(),
    newScene: vi.fn(),
    setSceneName: vi.fn(),
    engineMode: 'edit',
    undo: vi.fn(),
    redo: vi.fn(),
    canUndo: false,
    canRedo: false,
    undoDescription: null,
    redoDescription: null,
    projectId: null,
    cloudSaveStatus: 'idle',
    saveToCloud: vi.fn(),
    setCloudSaveStatus: vi.fn(),
    setLastCloudSave: vi.fn(),
    ...overrides,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useEditorStore).mockImplementation((selector: any) => selector(state));
}

describe('SceneToolbar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoadPrefabInstances.mockReturnValue([]);
    mockSaveSceneToCloud.mockResolvedValue({ ok: true, savedAt: '2026-01-01T00:00:00Z' });
  });
  afterEach(() => cleanup());

  it('renders scene name button', () => {
    mockEditorStore();
    render(<SceneToolbar />);
    expect(screen.getByText('My Scene')).toBeInTheDocument();
  });

  it('renders save, load, new, and export buttons', () => {
    mockEditorStore();
    render(<SceneToolbar />);
    expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /load/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /new scene/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /export/i })).toBeInTheDocument();
  });

  it('shows modification indicator when scene is modified', () => {
    mockEditorStore({ sceneModified: true });
    render(<SceneToolbar />);
    expect(screen.getByText('*')).toBeInTheDocument();
  });

  describe('scene-export correlation (PF-1103)', () => {
    function emitExport(detail: SceneExportedDetail) {
      act(() => {
        window.dispatchEvent(new CustomEvent(SCENE_EXPORTED_EVENT, { detail }));
      });
    }

    /** Click Save and return the request id the toolbar handed to saveScene. */
    function clickSave(saveScene: ReturnType<typeof vi.fn>): string {
      screen.getByRole('button', { name: /save/i }).click();
      expect(saveScene).toHaveBeenCalledTimes(1);
      const requestId = saveScene.mock.calls[0][0];
      expect(typeof requestId).toBe('string');
      return requestId as string;
    }

    it('downloads only the export it asked for', () => {
      const saveScene = vi.fn();
      mockEditorStore({ saveScene });
      render(<SceneToolbar />);

      const requestId = clickSave(saveScene);

      // Someone else's export lands first — it must not be consumed, and the
      // toolbar must still be waiting for its own.
      emitExport({ json: '{"other":true}', name: 'Theirs', requestId: `${requestId}-not` });
      expect(vi.mocked(downloadSceneFile)).not.toHaveBeenCalled();

      emitExport({ json: '{"mine":true}', name: 'Mine', requestId });
      expect(vi.mocked(downloadSceneFile)).toHaveBeenCalledExactlyOnceWith('{"mine":true}', 'Mine');
    });

    it('accepts an export with no request id (engine binary predating the change)', () => {
      const saveScene = vi.fn();
      mockEditorStore({ saveScene });
      render(<SceneToolbar />);

      clickSave(saveScene);
      emitExport({ json: '{"legacy":true}', name: 'Legacy' });

      expect(vi.mocked(downloadSceneFile)).toHaveBeenCalledExactlyOnceWith('{"legacy":true}', 'Legacy');
    });

    it('ignores exports when nothing is pending', () => {
      mockEditorStore();
      render(<SceneToolbar />);

      // An autosave tick exports the scene without anyone asking the toolbar for it.
      emitExport({ json: '{"autosave":true}', name: 'Auto' });

      expect(vi.mocked(downloadSceneFile)).not.toHaveBeenCalled();
    });

    it('settles a download exactly once — a second export is not a second download', () => {
      const saveScene = vi.fn();
      mockEditorStore({ saveScene });
      render(<SceneToolbar />);

      const requestId = clickSave(saveScene);
      emitExport({ json: '{"mine":true}', name: 'Mine', requestId });
      emitExport({ json: '{"mine":true}', name: 'Mine', requestId });

      expect(vi.mocked(downloadSceneFile)).toHaveBeenCalledTimes(1);
    });
  });

  // scene.FR-1 N1: the export→persist round trip (download AND cloud PUT) must
  // carry the live prefab-instance registry, or a linked instance and its
  // overrides vanish on reload — `restorePrefabInstances` resets the registry to
  // `[]` when the persisted scene has no `prefabInstances` field. These drive
  // the REAL save/reopen paths a user relies on, not the isolated fold helper.
  describe('prefab-instance persistence (scene.FR-1 N1)', () => {
    function emitExport(detail: SceneExportedDetail) {
      act(() => {
        window.dispatchEvent(new CustomEvent(SCENE_EXPORTED_EVENT, { detail }));
      });
    }

    const SEEDED = [{ instanceId: 'i1', prefabId: 'p1', overrides: { name: 'kept' } }];
    const SCENE = { formatVersion: 1, sceneName: 'S', entities: [] as unknown[] };

    it('folds linked prefab instances into the downloaded scene', () => {
      mockLoadPrefabInstances.mockReturnValue(SEEDED);
      const saveScene = vi.fn();
      mockEditorStore({ saveScene });
      render(<SceneToolbar />);

      screen.getByRole('button', { name: /save/i }).click();
      const requestId = saveScene.mock.calls[0][0] as string;
      emitExport({ json: JSON.stringify(SCENE), name: 'S', requestId });

      const [json] = vi.mocked(downloadSceneFile).mock.calls[0];
      const parsed = JSON.parse(json as string) as { prefabInstances?: typeof SEEDED };
      expect(parsed.prefabInstances).toHaveLength(1);
      expect(parsed.prefabInstances?.[0].instanceId).toBe('i1');
      expect(parsed.prefabInstances?.[0].overrides).toEqual({ name: 'kept' });
    });

    it('leaves the downloaded scene untouched when the registry is empty', () => {
      mockLoadPrefabInstances.mockReturnValue([]);
      const saveScene = vi.fn();
      mockEditorStore({ saveScene });
      render(<SceneToolbar />);

      screen.getByRole('button', { name: /save/i }).click();
      const requestId = saveScene.mock.calls[0][0] as string;
      emitExport({ json: JSON.stringify(SCENE), name: 'S', requestId });

      // Byte-identical: no prefabInstances key injected for an instance-free scene.
      expect(vi.mocked(downloadSceneFile)).toHaveBeenCalledExactlyOnceWith(JSON.stringify(SCENE), 'S');
    });

    it('folds linked prefab instances into the cloud PUT', () => {
      mockLoadPrefabInstances.mockReturnValue(SEEDED);
      const saveToCloud = vi.fn();
      mockEditorStore({ projectId: 'proj_1', saveToCloud, setCloudSaveStatus: vi.fn(), setLastCloudSave: vi.fn() });
      render(<SceneToolbar />);

      // Ctrl+S with a projectId set routes to the cloud-save path.
      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true }));
      });
      expect(saveToCloud).toHaveBeenCalledTimes(1);
      const requestId = saveToCloud.mock.calls[0][0] as string;

      emitExport({ json: JSON.stringify(SCENE), name: 'S', requestId });

      expect(mockSaveSceneToCloud).toHaveBeenCalledTimes(1);
      const [projectId, name, json] = mockSaveSceneToCloud.mock.calls[0] as unknown as [string, string, string];
      expect(projectId).toBe('proj_1');
      expect(name).toBe('S');
      const parsed = JSON.parse(json) as { prefabInstances?: typeof SEEDED };
      expect(parsed.prefabInstances).toHaveLength(1);
      expect(parsed.prefabInstances?.[0].instanceId).toBe('i1');
    });
  });
});
