import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { SceneNode } from '../SceneNode';
import type { SceneNode as SceneNodeData } from '@/stores/slices/types';
import { useEditorStore } from '@/stores/editorStore';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(() => ({})),
}));

describe('SceneNode', () => {
  const mockSelectEntity = vi.fn();
  const mockToggleVisibility = vi.fn();
  const mockOnContextMenu = vi.fn();
  const mockOnToggleExpand = vi.fn();

  const node = {
    entityId: 'e1',
    name: 'Test Cube',
    components: ['Transform', 'Mesh3d'],
    children: [],
    parentId: null,
    depth: 0,
    visible: true,
  } as SceneNodeData;

  beforeEach(() => {
    vi.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useEditorStore).mockImplementation((selector: any) => {
      const state = {
        selectedIds: new Set(),
        primaryId: null,
        sceneGraph: { nodes: { 'e1': node } },
        selectEntity: mockSelectEntity,
        toggleVisibility: mockToggleVisibility,
      };
      return selector(state);
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('renders entity name', () => {
    render(
      <SceneNode 
        node={node} 
        depth={0}
        onContextMenu={mockOnContextMenu}
      />
    );
    
    expect(screen.getByText('Test Cube')).toBeInTheDocument();
  });

  it('calls selectEntity when clicked', () => {
    render(
      <SceneNode 
        node={node} 
        depth={0}
        onContextMenu={mockOnContextMenu}
      />
    );
    
    fireEvent.click(screen.getByText('Test Cube'));
    expect(mockSelectEntity).toHaveBeenCalledWith('e1', 'replace');
  });

  it('calls toggleVisibility when Eye icon is clicked', () => {
    render(
      <SceneNode 
        node={node} 
        depth={0}
        onContextMenu={mockOnContextMenu}
      />
    );
    
    const visibilityBtn = screen.getByRole('button', { name: /Hide Test Cube/i });
    fireEvent.click(visibilityBtn);
    
    expect(mockToggleVisibility).toHaveBeenCalledWith('e1');
  });

  it('calls onToggleExpand when expansion arrow is clicked', () => {
    const nodeWithChildren = { ...node, children: ['e2'] };
    render(
      <SceneNode
        node={nodeWithChildren}
        depth={0}
        onContextMenu={mockOnContextMenu}
        onToggleExpand={mockOnToggleExpand}
      />
    );

    const expandBtn = screen.getByRole('button', { name: /Collapse Test Cube/i });
    fireEvent.click(expandBtn);

    expect(mockOnToggleExpand).toHaveBeenCalledWith('e1');
  });

  it('calls onDragStart with entityId and name when drag begins', () => {
    const mockOnDragStart = vi.fn();
    const { container } = render(
      <SceneNode
        node={node}
        depth={0}
        onContextMenu={mockOnContextMenu}
        onDragStart={mockOnDragStart}
      />
    );

    const draggable = container.querySelector('[draggable]') as HTMLElement;
    expect(draggable).not.toBeNull();
    // Provide a mock dataTransfer since jsdom does not implement it
    fireEvent.dragStart(draggable, {
      dataTransfer: {
        effectAllowed: 'move',
        setData: vi.fn(),
        getData: vi.fn(),
      },
    });

    expect(mockOnDragStart).toHaveBeenCalledWith('e1', 'Test Cube');
  });

  it('calls onDragEnd when drag finishes', () => {
    const mockOnDragEnd = vi.fn();
    const { container } = render(
      <SceneNode
        node={node}
        depth={0}
        onContextMenu={mockOnContextMenu}
        onDragEnd={mockOnDragEnd}
      />
    );

    const draggable = container.querySelector('[draggable]') as HTMLElement;
    expect(draggable).not.toBeNull();
    fireEvent.dragEnd(draggable);

    expect(mockOnDragEnd).toHaveBeenCalledTimes(1);
  });

  it('applies opacity-50 class when isBeingDragged is true', () => {
    const { container } = render(
      <SceneNode
        node={node}
        depth={0}
        onContextMenu={mockOnContextMenu}
        draggedEntityId="e1"
      />
    );

    const row = container.querySelector('[draggable]');
    expect(row).not.toBeNull();
    expect(row!.className).toContain('opacity-50');
  });
});
