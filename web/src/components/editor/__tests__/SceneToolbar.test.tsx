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

// scene.FR-1 N1: the prefab-instance fold itself now happens upstream (the
// single `SCENE_EXPORTED` choke point in `transformEvents.ts`, covered in its
// own test file) — the toolbar's job is to STAGE the registry as it stands at
// request time (`stagePrefabInstancesForExport`, closing the save/concurrent-
// load race) and otherwise pass the already-folded `e.detail.json` straight
// through. Mock the registry so a test can seed and assert against it.
const mockLoadPrefabInstances = vi.fn<() => unknown[]>(() => []);
const mockStagePrefabInstancesForExport = vi.fn<(requestId: string, instances: unknown[]) => void>();
vi.mock('@/lib/prefabs/prefabStore', () => ({
  loadPrefabInstances: () => mockLoadPrefabInstances(),
  stagePrefabInstancesForExport: (requestId: string, instances: unknown[]) =>
    mockStagePrefabInstancesForExport(requestId, instances),
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

  // scene.FR-1 N1: linked prefab instances must survive save/reopen. The fold
  // itself now happens upstream at the single `SCENE_EXPORTED` choke point in
  // `transformEvents.ts` (its own test file) — every consumer, this toolbar's
  // download/cloud-save included, receives ALREADY-folded JSON. What belongs to
  // the toolbar is (1) staging the registry at REQUEST time so that upstream
  // fold reflects what was active when the save was asked for, not whatever is
  // active when the answer lands (closes the concurrent-load race), and (2)
  // passing the already-folded JSON straight through without re-reading the
  // (possibly since-changed) live registry itself.
  describe('prefab-instance persistence (scene.FR-1 N1)', () => {
    function emitExport(detail: SceneExportedDetail) {
      act(() => {
        window.dispatchEvent(new CustomEvent(SCENE_EXPORTED_EVENT, { detail }));
      });
    }

    const SEEDED = [{ instanceId: 'i1', prefabId: 'p1', overrides: { name: 'kept' } }];
    // Already folded, as it would arrive from the upstream SCENE_EXPORTED fold.
    const FOLDED_SCENE = { formatVersion: 1, sceneName: 'S', entities: [] as unknown[], prefabInstances: SEEDED };

    it('stages the live registry at REQUEST time before asking for a download', () => {
      mockLoadPrefabInstances.mockReturnValue(SEEDED);
      const saveScene = vi.fn();
      mockEditorStore({ saveScene });
      render(<SceneToolbar />);

      screen.getByRole('button', { name: /save/i }).click();
      const requestId = saveScene.mock.calls[0][0] as string;

      // Staged BEFORE saveScene was even called, not after — proven by call order.
      expect(mockStagePrefabInstancesForExport).toHaveBeenCalledExactlyOnceWith(requestId, SEEDED);
      expect(mockStagePrefabInstancesForExport.mock.invocationCallOrder[0]).toBeLessThan(
        saveScene.mock.invocationCallOrder[0]
      );
    });

    it('stages the live registry at REQUEST time before asking for a cloud save', () => {
      mockLoadPrefabInstances.mockReturnValue(SEEDED);
      const saveToCloud = vi.fn();
      mockEditorStore({ projectId: 'proj_1', saveToCloud, setCloudSaveStatus: vi.fn(), setLastCloudSave: vi.fn() });
      render(<SceneToolbar />);

      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true }));
      });
      const requestId = saveToCloud.mock.calls[0][0] as string;

      expect(mockStagePrefabInstancesForExport).toHaveBeenCalledExactlyOnceWith(requestId, SEEDED);
      expect(mockStagePrefabInstancesForExport.mock.invocationCallOrder[0]).toBeLessThan(
        saveToCloud.mock.invocationCallOrder[0]
      );
    });

    it('downloads the already-folded JSON unmodified, without re-reading the live registry', () => {
      const saveScene = vi.fn();
      mockEditorStore({ saveScene });
      render(<SceneToolbar />);

      screen.getByRole('button', { name: /save/i }).click();
      const requestId = saveScene.mock.calls[0][0] as string;
      // The live registry has since changed — proves the toolbar does not fold
      // it in again on top of what the (already-folded) export JSON carries.
      mockLoadPrefabInstances.mockReturnValue([{ instanceId: 'changed', prefabId: 'x', overrides: {} }]);

      emitExport({ json: JSON.stringify(FOLDED_SCENE), name: 'S', requestId });

      expect(vi.mocked(downloadSceneFile)).toHaveBeenCalledExactlyOnceWith(JSON.stringify(FOLDED_SCENE), 'S');
    });

    it('PUTs the already-folded JSON unmodified to the cloud', () => {
      const saveToCloud = vi.fn();
      mockEditorStore({ projectId: 'proj_1', saveToCloud, setCloudSaveStatus: vi.fn(), setLastCloudSave: vi.fn() });
      render(<SceneToolbar />);

      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true }));
      });
      const requestId = saveToCloud.mock.calls[0][0] as string;
      mockLoadPrefabInstances.mockReturnValue([{ instanceId: 'changed', prefabId: 'x', overrides: {} }]);

      emitExport({ json: JSON.stringify(FOLDED_SCENE), name: 'S', requestId });

      expect(mockSaveSceneToCloud).toHaveBeenCalledExactlyOnceWith('proj_1', 'S', JSON.stringify(FOLDED_SCENE));
    });
  });
});
