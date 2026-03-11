/**
 * Render tests for MobileToolbar component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { MobileToolbar } from '../MobileToolbar';
import { useEditorStore } from '@/stores/editorStore';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(),
}));

vi.mock('@/components/editor/AddEntityMenu', () => ({
  AddEntityMenu: ({ onSpawn }: { onSpawn: (type: string) => void }) => (
    <button data-testid="add-entity-menu" onClick={() => onSpawn('cube')}>
      Add Entity
    </button>
  ),
}));

vi.mock('lucide-react', () => ({
  Move: (props: Record<string, unknown>) => <span data-testid="move-icon" {...props} />,
  RotateCw: (props: Record<string, unknown>) => <span data-testid="rotate-icon" {...props} />,
  Maximize2: (props: Record<string, unknown>) => <span data-testid="scale-icon" {...props} />,
  PanelLeft: (props: Record<string, unknown>) => <span data-testid="panel-left-icon" {...props} />,
  PanelRight: (props: Record<string, unknown>) => <span data-testid="panel-right-icon" {...props} />,
}));

describe('MobileToolbar', () => {
  const mockSetGizmoMode = vi.fn();
  const mockSpawnEntity = vi.fn();
  const mockOnToggleLeft = vi.fn();
  const mockOnToggleRight = vi.fn();

  function setupStore({ gizmoMode = 'translate' as string } = {}) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useEditorStore).mockImplementation((selector: any) => {
      const state = {
        gizmoMode,
        setGizmoMode: mockSetGizmoMode,
        spawnEntity: mockSpawnEntity,
      };
      return typeof selector === 'function' ? selector(state) : state;
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    setupStore();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders Scene Hierarchy toggle button', () => {
    render(<MobileToolbar onToggleLeft={mockOnToggleLeft} onToggleRight={mockOnToggleRight} />);
    expect(screen.getByTitle('Scene Hierarchy')).toBeDefined();
  });

  it('renders Inspector toggle button', () => {
    render(<MobileToolbar onToggleLeft={mockOnToggleLeft} onToggleRight={mockOnToggleRight} />);
    expect(screen.getByTitle('Inspector')).toBeDefined();
  });

  it('calls onToggleLeft when left panel button clicked', () => {
    render(<MobileToolbar onToggleLeft={mockOnToggleLeft} onToggleRight={mockOnToggleRight} />);
    fireEvent.click(screen.getByTitle('Scene Hierarchy'));
    expect(mockOnToggleLeft).toHaveBeenCalled();
  });

  it('calls onToggleRight when right panel button clicked', () => {
    render(<MobileToolbar onToggleLeft={mockOnToggleLeft} onToggleRight={mockOnToggleRight} />);
    fireEvent.click(screen.getByTitle('Inspector'));
    expect(mockOnToggleRight).toHaveBeenCalled();
  });

  it('renders Move gizmo button', () => {
    render(<MobileToolbar onToggleLeft={mockOnToggleLeft} onToggleRight={mockOnToggleRight} />);
    expect(screen.getByTitle('Move')).toBeDefined();
  });

  it('renders Rotate gizmo button', () => {
    render(<MobileToolbar onToggleLeft={mockOnToggleLeft} onToggleRight={mockOnToggleRight} />);
    expect(screen.getByTitle('Rotate')).toBeDefined();
  });

  it('renders Scale gizmo button', () => {
    render(<MobileToolbar onToggleLeft={mockOnToggleLeft} onToggleRight={mockOnToggleRight} />);
    expect(screen.getByTitle('Scale')).toBeDefined();
  });

  it('calls setGizmoMode when Rotate clicked', () => {
    render(<MobileToolbar onToggleLeft={mockOnToggleLeft} onToggleRight={mockOnToggleRight} />);
    fireEvent.click(screen.getByTitle('Rotate'));
    expect(mockSetGizmoMode).toHaveBeenCalledWith('rotate');
  });

  it('calls setGizmoMode when Scale clicked', () => {
    render(<MobileToolbar onToggleLeft={mockOnToggleLeft} onToggleRight={mockOnToggleRight} />);
    fireEvent.click(screen.getByTitle('Scale'));
    expect(mockSetGizmoMode).toHaveBeenCalledWith('scale');
  });

  it('renders AddEntityMenu', () => {
    render(<MobileToolbar onToggleLeft={mockOnToggleLeft} onToggleRight={mockOnToggleRight} />);
    expect(screen.getByTestId('add-entity-menu')).toBeDefined();
  });

  it('calls spawnEntity when AddEntityMenu triggers spawn', () => {
    render(<MobileToolbar onToggleLeft={mockOnToggleLeft} onToggleRight={mockOnToggleRight} />);
    fireEvent.click(screen.getByTestId('add-entity-menu'));
    expect(mockSpawnEntity).toHaveBeenCalledWith('cube');
  });
});
