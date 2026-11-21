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
  beforeEach(() => vi.clearAllMocks());
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
});
