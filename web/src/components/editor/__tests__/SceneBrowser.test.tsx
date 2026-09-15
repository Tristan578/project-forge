/**
 * Render tests for SceneBrowser component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@/test/utils/componentTestUtils';
import { SceneBrowser } from '../SceneBrowser';
import { useEditorStore } from '@/stores/editorStore';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(),
}));

vi.mock('lucide-react', () => ({
  X: (props: Record<string, unknown>) => <span data-testid="x-icon" {...props} />,
  Plus: (props: Record<string, unknown>) => <span data-testid="plus-icon" {...props} />,
  Trash2: (props: Record<string, unknown>) => <span data-testid="trash-icon" {...props} />,
  Copy: (props: Record<string, unknown>) => <span data-testid="copy-icon" {...props} />,
  CheckCircle2: (props: Record<string, unknown>) => <span data-testid="check-icon" {...props} />,
  Save: (props: Record<string, unknown>) => <span data-testid="save-icon" {...props} />,
  RotateCcw: (props: Record<string, unknown>) => <span data-testid="restore-icon" {...props} />,
}));

// PF-1100: switching and duplicating now read the live scene back out of the
// engine first, so both actions are async and the component chains off the
// returned promise. A bare `vi.fn()` would hand it `undefined` to chain from.
const mockSwitchScene = vi.fn(async () => {});
const mockCreateNewScene = vi.fn();
const mockDeleteScene = vi.fn();
const mockDuplicateScene = vi.fn(async () => {});
// scene.FR-3.OP-02 checkpoint actions.
const mockCreateCheckpoint = vi.fn(async () => ({ id: 'ckpt_1', label: 'cp', createdAt: 't', snapshot: {} }));
const mockListCheckpoints = vi.fn(() => [] as Array<{ id: string; label: string; createdAt: string; snapshot: unknown }>);
const mockRestoreCheckpoint = vi.fn(() => true);
const mockDeleteCheckpoint = vi.fn(() => []);

function buildState(overrides: {
  scenes?: Array<{ id: string; name: string; isStartScene: boolean }>;
  activeSceneId?: string | null;
  nodeCount?: number;
}) {
  const nodes: Record<string, { entityId: string; name: string; parentId: null; children: string[]; components: string[]; visible: boolean }> = {};
  for (let i = 0; i < (overrides.nodeCount ?? 0); i++) {
    nodes[`e${i}`] = { entityId: `e${i}`, name: `Entity ${i}`, parentId: null, children: [], components: [], visible: true };
  }
  return {
    scenes: overrides.scenes ?? [],
    activeSceneId: overrides.activeSceneId ?? null,
    sceneGraph: { nodes, rootIds: Object.keys(nodes) },
    switchScene: mockSwitchScene,
    createNewScene: mockCreateNewScene,
    deleteScene: mockDeleteScene,
    duplicateScene: mockDuplicateScene,
    createCheckpoint: mockCreateCheckpoint,
    listCheckpoints: mockListCheckpoints,
    restoreCheckpoint: mockRestoreCheckpoint,
    deleteCheckpoint: mockDeleteCheckpoint,
  };
}

function setupStore(overrides: Parameters<typeof buildState>[0] = {}) {
  const state = buildState(overrides);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useEditorStore).mockImplementation((selector: any) =>
    typeof selector === 'function' ? selector(state) : state
  );
}

describe('SceneBrowser', () => {
  const mockOnClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    setupStore();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders nothing when isOpen is false', () => {
    const { container } = render(<SceneBrowser isOpen={false} onClose={mockOnClose} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the dialog when isOpen is true', () => {
    render(<SceneBrowser isOpen onClose={mockOnClose} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('renders empty state message when there are no scenes', () => {
    setupStore({ scenes: [] });
    render(<SceneBrowser isOpen onClose={mockOnClose} />);
    expect(screen.getByText(/No scenes yet/i)).toBeInTheDocument();
  });

  it('renders the scene list with all scene names', () => {
    setupStore({
      scenes: [
        { id: 'scene-1', name: 'Main Level', isStartScene: true },
        { id: 'scene-2', name: 'Boss Level', isStartScene: false },
      ],
      activeSceneId: 'scene-1',
    });
    render(<SceneBrowser isOpen onClose={mockOnClose} />);
    expect(screen.getByText('Main Level')).toBeInTheDocument();
    expect(screen.getByText('Boss Level')).toBeInTheDocument();
  });

  it('marks the active scene as aria-selected', () => {
    setupStore({
      scenes: [
        { id: 'scene-1', name: 'Main Level', isStartScene: false },
        { id: 'scene-2', name: 'Boss Level', isStartScene: false },
      ],
      activeSceneId: 'scene-1',
    });
    render(<SceneBrowser isOpen onClose={mockOnClose} />);
    const options = screen.getAllByRole('option');
    expect(options[0].getAttribute('aria-selected')).toBe('true');
    expect(options[1].getAttribute('aria-selected')).toBe('false');
  });

  it('shows entity count for the active scene', () => {
    setupStore({
      scenes: [{ id: 'scene-1', name: 'Main Level', isStartScene: false }],
      activeSceneId: 'scene-1',
      nodeCount: 3,
    });
    render(<SceneBrowser isOpen onClose={mockOnClose} />);
    expect(screen.getByText('3 entities')).toBeInTheDocument();
  });

  it('shows start badge on the start scene', () => {
    setupStore({
      scenes: [{ id: 's1', name: 'StartScene', isStartScene: true }],
      activeSceneId: 's1',
    });
    render(<SceneBrowser isOpen onClose={mockOnClose} />);
    expect(screen.getByText('start')).toBeInTheDocument();
  });

  it('calls switchScene when a non-active scene is clicked', () => {
    setupStore({
      scenes: [
        { id: 'scene-1', name: 'Level 1', isStartScene: false },
        { id: 'scene-2', name: 'Level 2', isStartScene: false },
      ],
      activeSceneId: 'scene-1',
    });
    render(<SceneBrowser isOpen onClose={mockOnClose} />);
    fireEvent.click(screen.getByText('Level 2'));
    expect(mockSwitchScene).toHaveBeenCalledWith('scene-2');
  });

  it('does not call switchScene when the active scene is clicked', () => {
    setupStore({
      scenes: [{ id: 'scene-1', name: 'Level 1', isStartScene: false }],
      activeSceneId: 'scene-1',
    });
    render(<SceneBrowser isOpen onClose={mockOnClose} />);
    fireEvent.click(screen.getByText('Level 1'));
    expect(mockSwitchScene).not.toHaveBeenCalled();
  });

  it('ignores a second switch while the first is still in flight', async () => {
    // The capture round trip takes as long as the engine takes to answer, so
    // the window between clicks is real. A second switch starting inside it
    // would capture a scene that is already halfway through being replaced.
    let release!: () => void;
    mockSwitchScene.mockImplementationOnce(
      () => new Promise<void>((resolve) => { release = resolve; })
    );
    setupStore({
      scenes: [
        { id: 'scene-1', name: 'Level 1', isStartScene: false },
        { id: 'scene-2', name: 'Level 2', isStartScene: false },
        { id: 'scene-3', name: 'Level 3', isStartScene: false },
      ],
      activeSceneId: 'scene-1',
    });
    render(<SceneBrowser isOpen onClose={mockOnClose} />);

    fireEvent.click(screen.getByText('Level 2'));
    fireEvent.click(screen.getByText('Level 3'));
    expect(mockSwitchScene).toHaveBeenCalledTimes(1);
    expect(mockSwitchScene).toHaveBeenCalledWith('scene-2');

    // Once the first switch settles the row is live again.
    await act(async () => {
      release();
    });
    fireEvent.click(screen.getByText('Level 3'));
    expect(mockSwitchScene).toHaveBeenCalledTimes(2);
    expect(mockSwitchScene).toHaveBeenLastCalledWith('scene-3');
  });

  it('calls createNewScene when Add Scene button is clicked', () => {
    render(<SceneBrowser isOpen onClose={mockOnClose} />);
    fireEvent.click(screen.getByLabelText('Add new scene'));
    expect(mockCreateNewScene).toHaveBeenCalled();
  });

  it('calls onClose when the close button is clicked', () => {
    render(<SceneBrowser isOpen onClose={mockOnClose} />);
    fireEvent.click(screen.getByLabelText('Close scene browser'));
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('calls onClose when the backdrop overlay is clicked', () => {
    render(<SceneBrowser isOpen onClose={mockOnClose} />);
    // The outer dialog element is the overlay backdrop — clicking it calls onClose
    const dialog = screen.getByRole('dialog');
    fireEvent.click(dialog);
    expect(mockOnClose).toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Recovery checkpoints — scene.FR-3.OP-02 (manual controls)
  // -------------------------------------------------------------------------

  it('reads the checkpoint list from storage when opened', () => {
    render(<SceneBrowser isOpen onClose={mockOnClose} />);
    expect(mockListCheckpoints).toHaveBeenCalled();
    expect(screen.getByText(/No checkpoints yet/i)).toBeTruthy();
  });

  it('calls createCheckpoint when Save checkpoint is clicked', async () => {
    render(<SceneBrowser isOpen onClose={mockOnClose} />);
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Save checkpoint'));
    });
    expect(mockCreateCheckpoint).toHaveBeenCalled();
    // The list is re-read after creating so the new checkpoint appears.
    expect(mockListCheckpoints.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('restores a checkpoint after confirmation', () => {
    mockListCheckpoints.mockReturnValue([
      { id: 'cp1', label: 'pre-change', createdAt: 't', snapshot: {} },
    ]);
    render(<SceneBrowser isOpen onClose={mockOnClose} />);
    fireEvent.click(screen.getByLabelText('Restore pre-change'));
    // A confirm step guards the destructive restore.
    fireEvent.click(screen.getByLabelText('Confirm restore pre-change'));
    expect(mockRestoreCheckpoint).toHaveBeenCalledWith('cp1');
    mockListCheckpoints.mockReturnValue([]);
  });

  it('logs, rather than silently treating it as a success, when the store reports the restore failed', () => {
    // #9813 review finding: the return value used to be ignored entirely, so
    // a checkpoint deleted from another tab (or an engine that rejected the
    // scene load) still closed the confirm dialog and refreshed as if the
    // restore had landed. There is no dedicated error banner in this
    // component (createCheckpoint failures follow the same console-only
    // convention), so a log is the observable signal here.
    mockRestoreCheckpoint.mockReturnValueOnce(false);
    mockListCheckpoints.mockReturnValue([
      { id: 'cp1', label: 'pre-change', createdAt: 't', snapshot: {} },
    ]);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<SceneBrowser isOpen onClose={mockOnClose} />);
    fireEvent.click(screen.getByLabelText('Restore pre-change'));
    fireEvent.click(screen.getByLabelText('Confirm restore pre-change'));
    expect(mockRestoreCheckpoint).toHaveBeenCalledWith('cp1');
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to restore checkpoint'),
      'cp1'
    );
    errorSpy.mockRestore();
    mockListCheckpoints.mockReturnValue([]);
  });

  it('deletes a checkpoint after confirmation', () => {
    mockListCheckpoints.mockReturnValue([
      { id: 'cp1', label: 'scratch', createdAt: 't', snapshot: {} },
    ]);
    render(<SceneBrowser isOpen onClose={mockOnClose} />);
    fireEvent.click(screen.getByLabelText('Delete checkpoint scratch'));
    // A confirm step guards the irreversible checkpoint delete, matching scene
    // delete and checkpoint restore. The first click only arms the gate.
    expect(mockDeleteCheckpoint).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('Confirm delete checkpoint scratch'));
    expect(mockDeleteCheckpoint).toHaveBeenCalledWith('cp1');
    mockListCheckpoints.mockReturnValue([]);
  });

  it('does not delete a checkpoint when the confirm is cancelled', () => {
    mockListCheckpoints.mockReturnValue([
      { id: 'cp1', label: 'scratch', createdAt: 't', snapshot: {} },
    ]);
    render(<SceneBrowser isOpen onClose={mockOnClose} />);
    fireEvent.click(screen.getByLabelText('Delete checkpoint scratch'));
    fireEvent.click(screen.getByLabelText('Cancel delete checkpoint'));
    expect(mockDeleteCheckpoint).not.toHaveBeenCalled();
    // The delete control is back, so the safety net is still reachable.
    expect(screen.getByLabelText('Delete checkpoint scratch')).toBeInTheDocument();
    mockListCheckpoints.mockReturnValue([]);
  });
});
