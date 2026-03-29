import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@/test/utils/componentTestUtils';
import { SceneToolbar } from '../SceneToolbar';

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
});
