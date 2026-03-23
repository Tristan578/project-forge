/**
 * Render tests for EditModeInspector component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { EditModeInspector } from '../EditModeInspector';
import { useEditorStore } from '@/stores/editorStore';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(() => ({})),
}));

vi.mock('lucide-react', () => ({
  X: (props: Record<string, unknown>) => <span data-testid="x-icon" {...props} />,
  Box: (props: Record<string, unknown>) => <span data-testid="box-icon" {...props} />,
  Circle: (props: Record<string, unknown>) => <span data-testid="circle-icon" {...props} />,
  Square: (props: Record<string, unknown>) => <span data-testid="square-icon" {...props} />,
}));

describe('EditModeInspector', () => {
  const mockExitEditMode = vi.fn();
  const mockSetSelectionMode = vi.fn();
  const mockPerformMeshOperation = vi.fn();
  const mockRecalcNormals = vi.fn();
  const mockToggleWireframe = vi.fn();
  const mockToggleXray = vi.fn();

  function setupStore({
    editModeActive = false,
    editModeEntityId = null as string | null,
    selectionMode = 'vertex' as string,
    selectedIndices = [] as number[],
    wireframeVisible = false,
    xrayMode = false,
    vertexCount = 8,
    edgeCount = 12,
    faceCount = 6,
  } = {}) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useEditorStore).mockImplementation((_selector?: any) => ({
      editModeActive,
      editModeEntityId,
      selectionMode,
      selectedIndices,
      wireframeVisible,
      xrayMode,
      vertexCount,
      edgeCount,
      faceCount,
      exitEditMode: mockExitEditMode,
      setSelectionMode: mockSetSelectionMode,
      performMeshOperation: mockPerformMeshOperation,
      recalcNormals: mockRecalcNormals,
      toggleWireframe: mockToggleWireframe,
      toggleXray: mockToggleXray,
    }));
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('returns null when editModeActive is false', () => {
    setupStore({ editModeActive: false });
    const { container } = render(<EditModeInspector />);
    expect(container.firstChild).toBeNull();
  });

  it('returns null when editModeEntityId is null', () => {
    setupStore({ editModeActive: true, editModeEntityId: null });
    const { container } = render(<EditModeInspector />);
    expect(container.firstChild).toBeNull();
  });

  it('renders Edit Mode heading when active', () => {
    setupStore({ editModeActive: true, editModeEntityId: 'entity-1' });
    render(<EditModeInspector />);
    expect(screen.getByText('Edit Mode').textContent).toBe('Edit Mode');
  });

  it('calls exitEditMode when Exit button clicked', () => {
    setupStore({ editModeActive: true, editModeEntityId: 'entity-1' });
    render(<EditModeInspector />);
    fireEvent.click(screen.getByText('Exit'));
    expect(mockExitEditMode).toHaveBeenCalled();
  });

  it('renders selection mode buttons', () => {
    setupStore({ editModeActive: true, editModeEntityId: 'entity-1' });
    render(<EditModeInspector />);
    expect(screen.getByText('Vertex').textContent).toBe('Vertex');
    expect(screen.getByText('Edge').textContent).toBe('Edge');
    expect(screen.getByText('Face').textContent).toBe('Face');
  });

  it('calls setSelectionMode when Edge clicked', () => {
    setupStore({ editModeActive: true, editModeEntityId: 'entity-1' });
    render(<EditModeInspector />);
    fireEvent.click(screen.getByText('Edge'));
    expect(mockSetSelectionMode).toHaveBeenCalledWith('edge');
  });

  it('shows mesh stats', () => {
    setupStore({ editModeActive: true, editModeEntityId: 'entity-1', vertexCount: 8, edgeCount: 12, faceCount: 6 });
    render(<EditModeInspector />);
    expect(screen.getByText('8').textContent).toBe('8');
    expect(screen.getByText('12').textContent).toBe('12');
    expect(screen.getByText('6').textContent).toBe('6');
    expect(screen.getByText('Vertices').textContent).toBe('Vertices');
    expect(screen.getByText('Edges').textContent).toBe('Edges');
    expect(screen.getByText('Faces').textContent).toBe('Faces');
  });

  it('shows selected count', () => {
    setupStore({ editModeActive: true, editModeEntityId: 'entity-1', selectedIndices: [0, 1, 2], selectionMode: 'vertex' });
    render(<EditModeInspector />);
    expect(screen.getByText('Selected: 3 vertexs').textContent).toBe('Selected: 3 vertexs');
  });

  it('renders operation buttons', () => {
    setupStore({ editModeActive: true, editModeEntityId: 'entity-1' });
    render(<EditModeInspector />);
    expect(screen.getByText('Extrude').textContent).toBe('Extrude');
    expect(screen.getByText('Inset').textContent).toBe('Inset');
    expect(screen.getByText('Subdivide').textContent).toBe('Subdivide');
    expect(screen.getByText('Delete Selected').textContent).toBe('Delete Selected');
  });

  it('Extrude button is disabled when no indices selected', () => {
    setupStore({ editModeActive: true, editModeEntityId: 'entity-1', selectedIndices: [] });
    render(<EditModeInspector />);
    const extrudeButton = screen.getByText('Extrude');
    expect((extrudeButton as HTMLButtonElement).disabled).toBe(true);
  });

  it('calls performMeshOperation extrude when Extrude clicked with selection', () => {
    setupStore({ editModeActive: true, editModeEntityId: 'entity-1', selectedIndices: [0, 1] });
    render(<EditModeInspector />);
    fireEvent.click(screen.getByText('Extrude'));
    expect(mockPerformMeshOperation).toHaveBeenCalledWith('extrude', expect.objectContaining({ indices: [0, 1] }));
  });

  it('calls performMeshOperation subdivide when Subdivide clicked', () => {
    setupStore({ editModeActive: true, editModeEntityId: 'entity-1', selectedIndices: [] });
    render(<EditModeInspector />);
    fireEvent.click(screen.getByText('Subdivide'));
    expect(mockPerformMeshOperation).toHaveBeenCalledWith('subdivide', expect.objectContaining({ level: 1 }));
  });

  it('renders Wireframe and X-Ray display buttons', () => {
    setupStore({ editModeActive: true, editModeEntityId: 'entity-1' });
    render(<EditModeInspector />);
    expect(screen.getByText('Wireframe').textContent).toBe('Wireframe');
    expect(screen.getByText('X-Ray').textContent).toBe('X-Ray');
  });

  it('calls toggleWireframe when Wireframe clicked', () => {
    setupStore({ editModeActive: true, editModeEntityId: 'entity-1' });
    render(<EditModeInspector />);
    fireEvent.click(screen.getByText('Wireframe'));
    expect(mockToggleWireframe).toHaveBeenCalled();
  });

  it('renders Smooth and Flat normals buttons', () => {
    setupStore({ editModeActive: true, editModeEntityId: 'entity-1' });
    render(<EditModeInspector />);
    expect(screen.getByText('Smooth').textContent).toBe('Smooth');
    expect(screen.getByText('Flat').textContent).toBe('Flat');
  });

  it('calls recalcNormals(true) when Smooth clicked', () => {
    setupStore({ editModeActive: true, editModeEntityId: 'entity-1' });
    render(<EditModeInspector />);
    fireEvent.click(screen.getByText('Smooth'));
    expect(mockRecalcNormals).toHaveBeenCalledWith(true);
  });
});
