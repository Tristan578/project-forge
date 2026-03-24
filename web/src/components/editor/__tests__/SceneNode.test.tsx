import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { SceneNode } from '../SceneNode';
import type { SceneNode as SceneNodeData } from '@/stores/slices/types';
import { useEditorStore } from '@/stores/editorStore';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(() => ({})),
}));

vi.mock('../HighlightedText', () => ({
  HighlightedText: ({ text }: { text: string }) => <span>{text}</span>,
}));

vi.mock('lucide-react', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('lucide-react');
  return Object.fromEntries(Object.keys(actual).map(k => [k, () => null]));
});

describe('SceneNode', () => {
  const mockSelectEntity = vi.fn();
  const mockSelectRange = vi.fn();
  const mockToggleVisibility = vi.fn();
  const mockOnContextMenu = vi.fn();
  const mockOnToggleExpand = vi.fn();

  const node: SceneNodeData = {
    entityId: 'e1',
    name: 'Test Cube',
    components: ['Transform', 'Mesh3d'],
    children: [],
    parentId: null,
    visible: true,
  };

  function setupStore(overrides: {
    selectedIds?: Set<string>;
    primaryId?: string | null;
  } = {}) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useEditorStore).mockImplementation((selector: any) => {
      const state = {
        selectedIds: overrides.selectedIds ?? new Set<string>(),
        primaryId: overrides.primaryId ?? null,
        sceneGraph: { nodes: { 'e1': node } },
        selectEntity: mockSelectEntity,
        selectRange: mockSelectRange,
        toggleVisibility: mockToggleVisibility,
      };
      return selector(state);
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    setupStore();
  });

  afterEach(() => {
    cleanup();
  });

  // ── Basic rendering ───────────────────────────────────────────────────

  it('renders entity name', () => {
    render(
      <SceneNode
        node={node}
        depth={0}
        onContextMenu={mockOnContextMenu}
      />
    );
    expect(screen.getByText('Test Cube')).not.toBeNull();
  });

  it('exposes treeitem role with correct aria-selected when not selected', () => {
    render(
      <SceneNode
        node={node}
        depth={0}
        onContextMenu={mockOnContextMenu}
      />
    );
    const treeitem = screen.getByRole('treeitem');
    expect(treeitem.getAttribute('aria-selected')).toBe('false');
  });

  it('exposes aria-selected=true when entity is in selectedIds', () => {
    setupStore({ selectedIds: new Set(['e1']) });
    render(
      <SceneNode
        node={node}
        depth={0}
        onContextMenu={mockOnContextMenu}
      />
    );
    const treeitem = screen.getByRole('treeitem');
    expect(treeitem.getAttribute('aria-selected')).toBe('true');
  });

  // ── Normal click (replace selection) ─────────────────────────────────

  it('calls selectEntity with replace mode on normal click', () => {
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

  // ── Ctrl+click (toggle multi-select) ─────────────────────────────────

  it('calls selectEntity with toggle mode on Ctrl+click', () => {
    render(
      <SceneNode
        node={node}
        depth={0}
        onContextMenu={mockOnContextMenu}
      />
    );
    fireEvent.click(screen.getByText('Test Cube'), { ctrlKey: true });
    expect(mockSelectEntity).toHaveBeenCalledWith('e1', 'toggle');
  });

  it('calls selectEntity with toggle mode on Meta+click (macOS Cmd+click)', () => {
    render(
      <SceneNode
        node={node}
        depth={0}
        onContextMenu={mockOnContextMenu}
      />
    );
    fireEvent.click(screen.getByText('Test Cube'), { metaKey: true });
    expect(mockSelectEntity).toHaveBeenCalledWith('e1', 'toggle');
  });

  it('Ctrl+click on an already-selected entity still uses toggle (deselects)', () => {
    setupStore({ selectedIds: new Set(['e1']), primaryId: 'e1' });
    render(
      <SceneNode
        node={node}
        depth={0}
        onContextMenu={mockOnContextMenu}
      />
    );
    fireEvent.click(screen.getByText('Test Cube'), { ctrlKey: true });
    expect(mockSelectEntity).toHaveBeenCalledWith('e1', 'toggle');
    // selectRange should NOT be called for a Ctrl+click
    expect(mockSelectRange).not.toHaveBeenCalled();
  });

  // ── Shift+click (range select) ────────────────────────────────────────

  it('calls selectRange with primaryId and nodeId on Shift+click when primaryId is set', () => {
    setupStore({ selectedIds: new Set(['e0']), primaryId: 'e0' });
    render(
      <SceneNode
        node={node}
        depth={0}
        onContextMenu={mockOnContextMenu}
      />
    );
    fireEvent.click(screen.getByText('Test Cube'), { shiftKey: true });
    expect(mockSelectRange).toHaveBeenCalledWith('e0', 'e1');
    expect(mockSelectEntity).not.toHaveBeenCalled();
  });

  it('falls through to replace selection on Shift+click when no primaryId is set', () => {
    // When primaryId is null, shiftKey branch is skipped → falls to else (replace)
    setupStore({ primaryId: null });
    render(
      <SceneNode
        node={node}
        depth={0}
        onContextMenu={mockOnContextMenu}
      />
    );
    fireEvent.click(screen.getByText('Test Cube'), { shiftKey: true });
    // No primaryId → shiftKey condition false → replace
    expect(mockSelectEntity).toHaveBeenCalledWith('e1', 'replace');
    expect(mockSelectRange).not.toHaveBeenCalled();
  });

  // ── Visibility toggle ─────────────────────────────────────────────────

  it('calls toggleVisibility when visibility button is clicked', () => {
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

  it('does not call selectEntity when visibility button is clicked', () => {
    render(
      <SceneNode
        node={node}
        depth={0}
        onContextMenu={mockOnContextMenu}
      />
    );
    const visibilityBtn = screen.getByRole('button', { name: /Hide Test Cube/i });
    fireEvent.click(visibilityBtn);
    expect(mockSelectEntity).not.toHaveBeenCalled();
  });

  it('shows Show button (aria-label) when entity is hidden', () => {
    const hiddenNode: SceneNodeData = { ...node, visible: false };
    render(
      <SceneNode
        node={hiddenNode}
        depth={0}
        onContextMenu={mockOnContextMenu}
      />
    );
    const visibilityBtn = screen.getByRole('button', { name: /Show Test Cube/i });
    expect(visibilityBtn).not.toBeNull();
    fireEvent.click(visibilityBtn);
    expect(mockToggleVisibility).toHaveBeenCalledWith('e1');
  });

  it('visibility button has aria-pressed=true when entity is hidden', () => {
    const hiddenNode: SceneNodeData = { ...node, visible: false };
    render(
      <SceneNode
        node={hiddenNode}
        depth={0}
        onContextMenu={mockOnContextMenu}
      />
    );
    const visibilityBtn = screen.getByRole('button', { name: /Show Test Cube/i });
    expect(visibilityBtn.getAttribute('aria-pressed')).toBe('true');
  });

  it('visibility button has aria-pressed=false when entity is visible', () => {
    render(
      <SceneNode
        node={node}
        depth={0}
        onContextMenu={mockOnContextMenu}
      />
    );
    const visibilityBtn = screen.getByRole('button', { name: /Hide Test Cube/i });
    expect(visibilityBtn.getAttribute('aria-pressed')).toBe('false');
  });

  // ── Drag-and-drop ─────────────────────────────────────────────────────

  it('calls onDragStart with entityId and name when drag begins', () => {
    const mockOnDragStart = vi.fn();
    render(
      <SceneNode
        node={node}
        depth={0}
        onContextMenu={mockOnContextMenu}
        onDragStart={mockOnDragStart}
      />
    );
    const row = screen.getByRole('treeitem');
    const draggableDiv = row.querySelector('[draggable="true"]');
    expect(draggableDiv).not.toBeNull();
    // Provide a mock dataTransfer so jsdom doesn't throw on effectAllowed/setData
    fireEvent.dragStart(draggableDiv!, {
      dataTransfer: {
        effectAllowed: '',
        setData: vi.fn(),
        getData: vi.fn(),
      },
    });
    expect(mockOnDragStart).toHaveBeenCalledWith('e1', 'Test Cube');
  });

  it('calls onDragEnd when drag ends', () => {
    const mockOnDragEnd = vi.fn();
    render(
      <SceneNode
        node={node}
        depth={0}
        onContextMenu={mockOnContextMenu}
        onDragEnd={mockOnDragEnd}
      />
    );
    const row = screen.getByRole('treeitem');
    const draggableDiv = row.querySelector('[draggable="true"]');
    expect(draggableDiv).not.toBeNull();
    fireEvent.dragEnd(draggableDiv!);
    expect(mockOnDragEnd).toHaveBeenCalledTimes(1);
  });

  it('calls onDrop with entityId when drop occurs on a valid target', () => {
    const mockOnDrop = vi.fn();
    render(
      <SceneNode
        node={node}
        depth={0}
        onContextMenu={mockOnContextMenu}
        onDrop={mockOnDrop}
        isDragging={true}
        draggedEntityId="other-entity"
        invalidTargetIds={new Set()}
      />
    );
    const row = screen.getByRole('treeitem');
    const draggableDiv = row.querySelector('[draggable="true"]');
    expect(draggableDiv).not.toBeNull();
    fireEvent.drop(draggableDiv!, { preventDefault: vi.fn(), stopPropagation: vi.fn() });
    expect(mockOnDrop).toHaveBeenCalledWith('e1');
  });

  it('does not call onDrop when node is an invalid drop target', () => {
    const mockOnDrop = vi.fn();
    render(
      <SceneNode
        node={node}
        depth={0}
        onContextMenu={mockOnContextMenu}
        onDrop={mockOnDrop}
        isDragging={true}
        draggedEntityId="other-entity"
        invalidTargetIds={new Set(['e1'])}
      />
    );
    const row = screen.getByRole('treeitem');
    const draggableDiv = row.querySelector('[draggable="true"]');
    expect(draggableDiv).not.toBeNull();
    fireEvent.drop(draggableDiv!, { preventDefault: vi.fn(), stopPropagation: vi.fn() });
    expect(mockOnDrop).not.toHaveBeenCalled();
  });

  // ── Expand / collapse ─────────────────────────────────────────────────

  it('calls onToggleExpand when expansion arrow is clicked', () => {
    const nodeWithChildren: SceneNodeData = { ...node, children: ['e2'] };
    render(
      <SceneNode
        node={nodeWithChildren}
        depth={0}
        onContextMenu={mockOnContextMenu}
        onToggleExpand={mockOnToggleExpand}
        expandedIds={new Set(['e1'])}
      />
    );
    const expandBtn = screen.getByRole('button', { name: /Collapse Test Cube/i });
    fireEvent.click(expandBtn);
    expect(mockOnToggleExpand).toHaveBeenCalledWith('e1');
  });

  it('shows Expand button label when node is collapsed', () => {
    const nodeWithChildren: SceneNodeData = { ...node, children: ['e2'] };
    render(
      <SceneNode
        node={nodeWithChildren}
        depth={0}
        onContextMenu={mockOnContextMenu}
        onToggleExpand={mockOnToggleExpand}
        expandedIds={new Set()} // collapsed
      />
    );
    expect(screen.getByRole('button', { name: /Expand Test Cube/i })).not.toBeNull();
  });
});
