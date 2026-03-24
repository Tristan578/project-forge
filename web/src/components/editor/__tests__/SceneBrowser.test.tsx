/**
 * Render tests for SceneBrowser component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
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
}));

const mockSwitchScene = vi.fn();
const mockCreateNewScene = vi.fn();
const mockDeleteScene = vi.fn();
const mockDuplicateScene = vi.fn();

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
    expect(screen.getByRole('dialog')).not.toBeNull();
  });

  it('renders empty state message when there are no scenes', () => {
    setupStore({ scenes: [] });
    render(<SceneBrowser isOpen onClose={mockOnClose} />);
    expect(screen.getByText(/No scenes yet/i)).not.toBeNull();
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
    expect(screen.getByText('Main Level')).not.toBeNull();
    expect(screen.getByText('Boss Level')).not.toBeNull();
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
    expect(screen.getByText('3 entities')).not.toBeNull();
  });

  it('shows start badge on the start scene', () => {
    setupStore({
      scenes: [{ id: 's1', name: 'StartScene', isStartScene: true }],
      activeSceneId: 's1',
    });
    render(<SceneBrowser isOpen onClose={mockOnClose} />);
    expect(screen.getByText('start')).not.toBeNull();
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
});
