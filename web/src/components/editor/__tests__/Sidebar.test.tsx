import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { Sidebar } from '../Sidebar';
import { useEditorStore } from '@/stores/editorStore';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(),
}));

vi.mock('@/stores/chatStore', () => ({
  useChatStore: vi.fn((selector: (s: unknown) => unknown) => selector({
    rightPanelTab: 'chat',
    setRightPanelTab: vi.fn(),
  })),
}));

vi.mock('@/stores/workspaceStore', () => ({
  useWorkspaceStore: vi.fn((selector: (s: unknown) => unknown) => selector({
    openPanel: vi.fn(),
    chatOverlayOpen: false,
    toggleChatOverlay: vi.fn(),
  })),
}));

describe('Sidebar', () => {
  const mockSetGizmoMode = vi.fn();
  const mockToggleCoordinateMode = vi.fn();
  const mockTogglePlayMode = vi.fn();
  const mockToggleGrid = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useEditorStore).mockImplementation((selector: any) => {
      const state = {
        setGizmoMode: mockSetGizmoMode,
        toggleCoordinateMode: mockToggleCoordinateMode,
        togglePlayMode: mockTogglePlayMode,
        gizmoMode: 'translate',
        coordinateMode: 'world',
        engineMode: 'edit',
        selectedIds: new Set(),
        primaryId: null,
        canUndo: false,
        canRedo: false,
        snapSettings: { gridVisible: true },
        undo: vi.fn(),
        redo: vi.fn(),
        toggleGrid: mockToggleGrid,
        setCameraPreset: vi.fn(),
        spawnEntity: vi.fn(),
        deleteSelectedEntities: vi.fn(),
        duplicateSelectedEntity: vi.fn(),
        play: vi.fn(),
        stop: vi.fn(),
      };
      return selector(state);
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders correctly', () => {
    render(<Sidebar />);
    expect(screen.getByRole('toolbar', { name: /Editor tools/i })).toBeDefined();
  });

  it('shows gizmo controls and allows switching', () => {
    render(<Sidebar />);
    
    // Check for translate button
    const translateBtn = screen.getByRole('button', { name: /translate/i });
    fireEvent.click(translateBtn);
    expect(mockSetGizmoMode).toHaveBeenCalledWith('translate');

    // Check for rotate button
    const rotateBtn = screen.getByRole('button', { name: /rotate/i });
    fireEvent.click(rotateBtn);
    expect(mockSetGizmoMode).toHaveBeenCalledWith('rotate');
  });

  it('allows toggling coordinate mode', () => {
    render(<Sidebar />);
    
    const coordBtn = screen.getByRole('button', { name: /coordinates/i });
    fireEvent.click(coordBtn);
    
    expect(mockToggleCoordinateMode).toHaveBeenCalled();
  });

  it('allows toggling grid', () => {
    render(<Sidebar />);
    const gridBtn = screen.getByRole('button', { name: /grid/i });
    fireEvent.click(gridBtn);
    expect(mockToggleGrid).toHaveBeenCalledOnce();
  });
});
