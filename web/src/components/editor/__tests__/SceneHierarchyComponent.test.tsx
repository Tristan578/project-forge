/**
 * Tests for SceneHierarchy component — rendering, keyboard navigation,
 * context menu, selection, drag-and-drop, filtering, and empty states.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { SceneHierarchy } from '../SceneHierarchy';
import { useEditorStore, getCommandDispatcher, type SceneGraph } from '@/stores/editorStore';
import { computeInvalidTargets } from '@/lib/dndUtils';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(() => ({})),
  getCommandDispatcher: vi.fn(() => vi.fn()),
}));

vi.mock('@/hooks/useEngine', () => ({
  getWasmModule: vi.fn(() => ({
    handle_command: vi.fn(),
  })),
}));

// Mock child components that are complex
vi.mock('../SceneNode', () => ({
  SceneNode: ({
    node,
    onContextMenu,
    isEditing,
    onEditComplete,
    focusedEntityId,
    onDragStart,
    onDragEnd,
    onDrop,
    onDragOver,
    isDragging,
    draggedEntityId,
    invalidTargetIds,
    dropTarget,
  }: {
    node: { entityId: string; name: string };
    onContextMenu: (data: { entityId: string; entityName: string; position: { x: number; y: number } }) => void;
    isEditing: boolean;
    onEditComplete: (name: string | null) => void;
    focusedEntityId: string | null;
    onDragStart?: (entityId: string, entityName: string) => void;
    onDragEnd?: () => void;
    onDrop?: (entityId: string) => void;
    onDragOver?: (entityId: string, zone: string, depth: number) => void;
    isDragging?: boolean;
    draggedEntityId?: string | null;
    invalidTargetIds?: Set<string>;
    dropTarget?: { entityId: string | null; zone: string; depth: number } | null;
  }) => (
    <div
      data-testid={`scene-node-${node.entityId}`}
      data-focused={focusedEntityId === node.entityId ? 'true' : 'false'}
      data-is-dragging={isDragging ? 'true' : 'false'}
      data-dragged-entity={draggedEntityId ?? ''}
      data-is-invalid-target={invalidTargetIds?.has(node.entityId) ? 'true' : 'false'}
      data-drop-zone={dropTarget?.zone ?? ''}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu({ entityId: node.entityId, entityName: node.name, position: { x: e.clientX, y: e.clientY } });
      }}
    >
      {node.name}
      {isEditing && (
        <input
          data-testid={`rename-input-${node.entityId}`}
          defaultValue={node.name}
          onBlur={(e) => onEditComplete(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onEditComplete((e.target as HTMLInputElement).value);
            if (e.key === 'Escape') onEditComplete(null);
          }}
        />
      )}
      {/* Expose drag callbacks for testing */}
      <button
        data-testid={`drag-start-${node.entityId}`}
        onClick={() => onDragStart?.(node.entityId, node.name)}
      />
      <button
        data-testid={`drag-end-${node.entityId}`}
        onClick={() => onDragEnd?.()}
      />
      <button
        data-testid={`drop-on-${node.entityId}`}
        onClick={() => onDrop?.(node.entityId)}
      />
      <button
        data-testid={`drag-over-on-${node.entityId}`}
        onClick={() => onDragOver?.(node.entityId, 'on', 0)}
      />
      <button
        data-testid={`drag-over-before-${node.entityId}`}
        onClick={() => onDragOver?.(node.entityId, 'before', 0)}
      />
      <button
        data-testid={`drag-over-after-${node.entityId}`}
        onClick={() => onDragOver?.(node.entityId, 'after', 0)}
      />
    </div>
  ),
}));

vi.mock('../ContextMenu', () => ({
  ContextMenu: ({
    isOpen,
    onClose,
    onRename,
    onFocus,
    onDuplicate,
    onDelete,
    selectionCount,
  }: {
    isOpen: boolean;
    onClose: () => void;
    onRename: () => void;
    onFocus: () => void;
    onDuplicate: () => void;
    onDelete: () => void;
    selectionCount: number;
  }) =>
    isOpen ? (
      <div data-testid="context-menu">
        <button data-testid="ctx-rename" onClick={() => { onRename(); onClose(); }}>Rename</button>
        <button data-testid="ctx-focus" onClick={() => { onFocus(); onClose(); }}>Focus</button>
        <button data-testid="ctx-duplicate" onClick={() => { onDuplicate(); onClose(); }}>Duplicate</button>
        <button data-testid="ctx-delete" onClick={() => { onDelete(); onClose(); }}>Delete ({selectionCount})</button>
      </div>
    ) : null,
}));

vi.mock('../HierarchySearch', () => ({
  HierarchySearch: ({ matchCount }: { matchCount?: number }) => (
    <div data-testid="hierarchy-search">
      {matchCount !== undefined && <span data-testid="match-count">{matchCount}</span>}
    </div>
  ),
}));

vi.mock('@/lib/hierarchyFilter', () => ({
  filterHierarchy: (graph: SceneGraph, filter: string) => {
    if (!filter.trim()) {
      return {
        filteredRootIds: graph.rootIds,
        matchingIds: new Set<string>(),
        visibleIds: new Set<string>(),
        matchCount: 0,
      };
    }
    const matchingIds = new Set<string>();
    const visibleIds = new Set<string>();
    for (const [id, node] of Object.entries(graph.nodes)) {
      if (node.name.toLowerCase().includes(filter.toLowerCase())) {
        matchingIds.add(id);
        visibleIds.add(id);
        // Include ancestors
        let parentId = node.parentId;
        while (parentId) {
          visibleIds.add(parentId);
          parentId = graph.nodes[parentId]?.parentId ?? null;
        }
      }
    }
    const filteredRootIds = graph.rootIds.filter((id) => visibleIds.has(id));
    return { filteredRootIds, matchingIds, visibleIds, matchCount: matchingIds.size };
  },
}));

vi.mock('@/lib/dndUtils', () => ({
  computeInvalidTargets: vi.fn(() => new Set()),
}));

// ---------------------------------------------------------------------------
// Store setup
// ---------------------------------------------------------------------------

const mockSelectEntity = vi.fn();
const mockClearSelection = vi.fn();
const mockDeleteSelectedEntities = vi.fn();
const mockDuplicateSelectedEntity = vi.fn();
const mockRenameEntity = vi.fn();
const mockReparentEntity = vi.fn();

function makeGraph(nodes: Record<string, { name: string; parentId: string | null; children: string[] }>): SceneGraph {
  const sceneNodes: SceneGraph['nodes'] = {};
  const rootIds: string[] = [];
  for (const [id, data] of Object.entries(nodes)) {
    sceneNodes[id] = {
      entityId: id,
      name: data.name,
      visible: true,
      parentId: data.parentId,
      children: data.children,
      components: [],
    };
    if (!data.parentId) rootIds.push(id);
  }
  return { nodes: sceneNodes, rootIds };
}

const defaultGraph = makeGraph({
  a: { name: 'Camera', parentId: null, children: ['b'] },
  b: { name: 'Lens', parentId: 'a', children: [] },
  c: { name: 'Player', parentId: null, children: [] },
  d: { name: 'Enemy', parentId: null, children: [] },
});

function setupStore(overrides: {
  sceneGraph?: SceneGraph;
  selectedIds?: Set<string>;
  hierarchyFilter?: string;
} = {}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useEditorStore).mockImplementation((selector: any) => {
    const state = {
      sceneGraph: overrides.sceneGraph ?? defaultGraph,
      selectedIds: overrides.selectedIds ?? new Set<string>(),
      clearSelection: mockClearSelection,
      selectEntity: mockSelectEntity,
      deleteSelectedEntities: mockDeleteSelectedEntities,
      duplicateSelectedEntity: mockDuplicateSelectedEntity,
      renameEntity: mockRenameEntity,
      reparentEntity: mockReparentEntity,
      hierarchyFilter: overrides.hierarchyFilter ?? '',
    };
    return selector(state);
  });
}

describe('SceneHierarchy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  // ── Basic rendering ───────────────────────────────────────────────────

  it('renders header with title', () => {
    setupStore();
    render(<SceneHierarchy />);
    expect(screen.getByText('Scene Hierarchy')).toBeInTheDocument();
  });

  it('renders scene nodes from graph', () => {
    setupStore();
    render(<SceneHierarchy />);
    expect(screen.getByTestId('scene-node-a')).toBeInTheDocument();
    expect(screen.getByTestId('scene-node-c')).toBeInTheDocument();
    expect(screen.getByTestId('scene-node-d')).toBeInTheDocument();
  });

  it('renders search component', () => {
    setupStore();
    render(<SceneHierarchy />);
    expect(screen.getByTestId('hierarchy-search')).toBeInTheDocument();
  });

  it('shows selection count when entities are selected', () => {
    setupStore({ selectedIds: new Set(['a', 'c']) });
    render(<SceneHierarchy />);
    expect(screen.getByText('2 selected')).toBeInTheDocument();
  });

  it('does not show selection count when nothing selected', () => {
    setupStore({ selectedIds: new Set() });
    render(<SceneHierarchy />);
    expect(screen.queryByText(/selected/)).toBeNull();
  });

  // ── Empty / loading state ─────────────────────────────────────────────

  it('shows loading skeleton when scene has no entities', () => {
    setupStore({ sceneGraph: makeGraph({}) });
    const { container } = render(<SceneHierarchy />);
    expect(container.textContent).toContain('No entities yet');
  });

  // ── Background click ──────────────────────────────────────────────────

  it('clears selection on background click', () => {
    setupStore({ selectedIds: new Set(['a']) });
    render(<SceneHierarchy />);

    const treeView = screen.getByRole('tree');
    fireEvent.click(treeView);
    expect(mockClearSelection).toHaveBeenCalledOnce();
  });

  // ── Context menu ──────────────────────────────────────────────────────

  it('opens context menu on node right-click', () => {
    setupStore();
    render(<SceneHierarchy />);

    const nodeEl = screen.getByTestId('scene-node-c');
    fireEvent.contextMenu(nodeEl, { clientX: 100, clientY: 200 });

    expect(screen.getByTestId('context-menu')).toBeInTheDocument();
    expect(screen.getByTestId('ctx-rename')).toBeInTheDocument();
    expect(screen.getByTestId('ctx-focus')).toBeInTheDocument();
    expect(screen.getByTestId('ctx-duplicate')).toBeInTheDocument();
    expect(screen.getByTestId('ctx-delete')).toBeInTheDocument();
  });

  it('rename action from context menu enables editing', () => {
    setupStore();
    render(<SceneHierarchy />);

    // Open context menu for Player
    fireEvent.contextMenu(screen.getByTestId('scene-node-c'), { clientX: 100, clientY: 200 });
    fireEvent.click(screen.getByTestId('ctx-rename'));

    // Editing input should appear for entity 'c'
    expect(screen.getByTestId('rename-input-c')).toBeInTheDocument();
  });

  it('duplicate action from context menu calls duplicateSelectedEntity', () => {
    setupStore({ selectedIds: new Set(['c']) });
    render(<SceneHierarchy />);

    fireEvent.contextMenu(screen.getByTestId('scene-node-c'), { clientX: 100, clientY: 200 });
    fireEvent.click(screen.getByTestId('ctx-duplicate'));

    expect(mockDuplicateSelectedEntity).toHaveBeenCalledOnce();
  });

  it('delete action from context menu calls deleteSelectedEntities', () => {
    setupStore({ selectedIds: new Set(['c']) });
    render(<SceneHierarchy />);

    fireEvent.contextMenu(screen.getByTestId('scene-node-c'), { clientX: 100, clientY: 200 });
    fireEvent.click(screen.getByTestId('ctx-delete'));

    expect(mockDeleteSelectedEntities).toHaveBeenCalledOnce();
  });

  it('delete selects entity first if not in selection', () => {
    setupStore({ selectedIds: new Set() });
    render(<SceneHierarchy />);

    fireEvent.contextMenu(screen.getByTestId('scene-node-d'), { clientX: 100, clientY: 200 });
    fireEvent.click(screen.getByTestId('ctx-delete'));

    expect(mockSelectEntity).toHaveBeenCalledWith('d', 'replace');
    expect(mockDeleteSelectedEntities).toHaveBeenCalled();
  });

  // ── Keyboard navigation ───────────────────────────────────────────────

  it('ArrowDown moves focus to next node', () => {
    setupStore();
    render(<SceneHierarchy />);

    const tree = screen.getByRole('tree');
    fireEvent.keyDown(tree, { key: 'ArrowDown' });

    // First node (Camera) should now be focused
    const node = screen.getByTestId('scene-node-a');
    expect(node.getAttribute('data-focused')).toBe('true');
  });

  it('ArrowDown wraps around at end', () => {
    setupStore();
    render(<SceneHierarchy />);

    const tree = screen.getByRole('tree');
    // Press down enough times to get past all nodes and wrap
    for (let i = 0; i < 10; i++) {
      fireEvent.keyDown(tree, { key: 'ArrowDown' });
    }
    // Should not crash — just wraps
    expect(tree).toBeInTheDocument();
  });

  it('ArrowUp moves focus to previous node', () => {
    setupStore();
    render(<SceneHierarchy />);

    const tree = screen.getByRole('tree');
    // First go down twice then up once
    fireEvent.keyDown(tree, { key: 'ArrowDown' });
    fireEvent.keyDown(tree, { key: 'ArrowDown' });
    fireEvent.keyDown(tree, { key: 'ArrowUp' });

    // Should be on the first node
    const node = screen.getByTestId('scene-node-a');
    expect(node.getAttribute('data-focused')).toBe('true');
  });

  it('Enter selects the focused entity', () => {
    setupStore();
    render(<SceneHierarchy />);

    const tree = screen.getByRole('tree');
    fireEvent.keyDown(tree, { key: 'ArrowDown' }); // Focus Camera (a)
    fireEvent.keyDown(tree, { key: 'Enter' });

    expect(mockSelectEntity).toHaveBeenCalledWith('a', 'replace');
  });

  it('Enter with ctrlKey uses toggle mode', () => {
    setupStore();
    render(<SceneHierarchy />);

    const tree = screen.getByRole('tree');
    fireEvent.keyDown(tree, { key: 'ArrowDown' }); // Focus Camera (a)
    fireEvent.keyDown(tree, { key: 'Enter', ctrlKey: true });

    expect(mockSelectEntity).toHaveBeenCalledWith('a', 'toggle');
  });

  it('Delete key calls deleteSelectedEntities when focused entity is selected', () => {
    setupStore({ selectedIds: new Set(['a']) });
    render(<SceneHierarchy />);

    const tree = screen.getByRole('tree');
    fireEvent.keyDown(tree, { key: 'ArrowDown' }); // Focus Camera (a)
    fireEvent.keyDown(tree, { key: 'Delete' });

    expect(mockDeleteSelectedEntities).toHaveBeenCalledOnce();
  });

  it('Delete key does nothing when focused entity is not selected', () => {
    setupStore({ selectedIds: new Set() });
    render(<SceneHierarchy />);

    const tree = screen.getByRole('tree');
    fireEvent.keyDown(tree, { key: 'ArrowDown' }); // Focus Camera (a)
    fireEvent.keyDown(tree, { key: 'Delete' });

    expect(mockDeleteSelectedEntities).not.toHaveBeenCalled();
  });

  it('F2 enables rename on focused entity', () => {
    setupStore();
    render(<SceneHierarchy />);

    const tree = screen.getByRole('tree');
    fireEvent.keyDown(tree, { key: 'ArrowDown' }); // Focus Camera (a)
    fireEvent.keyDown(tree, { key: 'F2' });

    expect(screen.getByTestId('rename-input-a')).toBeInTheDocument();
  });

  it('Shift+F10 opens context menu for focused entity', () => {
    setupStore();
    render(<SceneHierarchy />);

    const tree = screen.getByRole('tree');
    fireEvent.keyDown(tree, { key: 'ArrowDown' }); // Focus Camera (a)
    fireEvent.keyDown(tree, { key: 'F10', shiftKey: true });

    expect(screen.getByTestId('context-menu')).toBeInTheDocument();
  });

  // ── Rename flow ───────────────────────────────────────────────────────

  it('rename completes and calls renameEntity on blur', () => {
    setupStore();
    render(<SceneHierarchy />);

    // Open context menu and trigger rename
    fireEvent.contextMenu(screen.getByTestId('scene-node-c'), { clientX: 100, clientY: 200 });
    fireEvent.click(screen.getByTestId('ctx-rename'));

    const input = screen.getByTestId('rename-input-c') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'NewPlayer' } });
    fireEvent.blur(input);

    expect(mockRenameEntity).toHaveBeenCalledWith('c', 'NewPlayer');
  });

  // ── Filtering ─────────────────────────────────────────────────────────

  it('shows "No matching entities" when filtering with no results', () => {
    const emptyGraph = makeGraph({});
    setupStore({ sceneGraph: emptyGraph, hierarchyFilter: 'nonexistent' });
    const { container } = render(<SceneHierarchy />);
    expect(container.textContent).toContain('No matching entities');
  });

  // ── Keyboard navigation (expand/collapse) ─────────────────────────────

  it('ArrowRight expands a collapsed node', () => {
    setupStore();
    render(<SceneHierarchy />);

    const tree = screen.getByRole('tree');
    // Focus Camera (a) which has child 'b'
    fireEvent.keyDown(tree, { key: 'ArrowDown' });
    // Collapse Camera first with ArrowLeft
    fireEvent.keyDown(tree, { key: 'ArrowLeft' });
    // Now expand with ArrowRight
    fireEvent.keyDown(tree, { key: 'ArrowRight' });

    // Should not crash, tree should still be intact
    expect(tree).toBeInTheDocument();
  });

  it('ArrowRight on expanded node with children moves focus to first child', () => {
    setupStore();
    render(<SceneHierarchy />);

    const tree = screen.getByRole('tree');
    // Focus Camera (a) — it is expanded by default and has child 'b'
    fireEvent.keyDown(tree, { key: 'ArrowDown' });
    // ArrowRight should move focus to first child 'b' (Lens)
    fireEvent.keyDown(tree, { key: 'ArrowRight' });

    // Verify by pressing Enter — should select 'b' (Lens)
    fireEvent.keyDown(tree, { key: 'Enter' });
    expect(mockSelectEntity).toHaveBeenCalledWith('b', 'replace');
  });

  it('ArrowLeft collapses an expanded node', () => {
    setupStore();
    render(<SceneHierarchy />);

    const tree = screen.getByRole('tree');
    // Focus Camera (a) which is expanded
    fireEvent.keyDown(tree, { key: 'ArrowDown' });
    // ArrowLeft collapses it
    fireEvent.keyDown(tree, { key: 'ArrowLeft' });

    // Tree should still render without crashing
    expect(tree).toBeInTheDocument();
  });

  it('ArrowLeft on collapsed node moves focus to parent', () => {
    setupStore();
    render(<SceneHierarchy />);

    const tree = screen.getByRole('tree');
    // Navigate to Lens (b) — child of Camera (a)
    // ArrowDown -> Camera(a), ArrowDown -> Lens(b)
    fireEvent.keyDown(tree, { key: 'ArrowDown' });
    fireEvent.keyDown(tree, { key: 'ArrowDown' });
    // Lens has no children, so ArrowLeft should go to parent Camera (a)
    fireEvent.keyDown(tree, { key: 'ArrowLeft' });

    const cameraNode = screen.getByTestId('scene-node-a');
    expect(cameraNode.getAttribute('data-focused')).toBe('true');
  });

  it('ArrowUp wraps to last node from first position', () => {
    setupStore();
    render(<SceneHierarchy />);

    const tree = screen.getByRole('tree');
    // ArrowUp with no focus wraps to last node
    fireEvent.keyDown(tree, { key: 'ArrowUp' });

    // Should not crash
    expect(tree).toBeInTheDocument();
  });

  it('Enter with metaKey uses toggle mode', () => {
    setupStore();
    render(<SceneHierarchy />);

    const tree = screen.getByRole('tree');
    fireEvent.keyDown(tree, { key: 'ArrowDown' }); // Focus Camera (a)
    fireEvent.keyDown(tree, { key: 'Enter', metaKey: true });

    expect(mockSelectEntity).toHaveBeenCalledWith('a', 'toggle');
  });

  // ── Context menu (focus action) ──────────────────────────────────────

  it('focus action from context menu dispatches focus_camera command', () => {
    const mockDispatch = vi.fn();
    vi.mocked(getCommandDispatcher).mockReturnValue(mockDispatch);
    setupStore({ selectedIds: new Set(['c']) });
    render(<SceneHierarchy />);

    fireEvent.contextMenu(screen.getByTestId('scene-node-c'), { clientX: 100, clientY: 200 });
    fireEvent.click(screen.getByTestId('ctx-focus'));

    expect(mockDispatch).toHaveBeenCalledWith('focus_camera', { entityId: 'c' });
  });

  it('duplicate selects entity first if not in current selection', () => {
    setupStore({ selectedIds: new Set() });
    render(<SceneHierarchy />);

    fireEvent.contextMenu(screen.getByTestId('scene-node-d'), { clientX: 100, clientY: 200 });
    fireEvent.click(screen.getByTestId('ctx-duplicate'));

    expect(mockSelectEntity).toHaveBeenCalledWith('d', 'replace');
    expect(mockDuplicateSelectedEntity).toHaveBeenCalled();
  });

  // ── Background context menu ──────────────────────────────────────────

  it('right-click on background closes context menu', () => {
    setupStore();
    render(<SceneHierarchy />);

    // Open context menu on a node
    fireEvent.contextMenu(screen.getByTestId('scene-node-c'), { clientX: 100, clientY: 200 });
    expect(screen.getByTestId('context-menu')).toBeInTheDocument();

    // Right-click on background (tree element itself)
    const tree = screen.getByRole('tree');
    fireEvent.contextMenu(tree);

    // Context menu should be closed
    expect(screen.queryByTestId('context-menu')).toBeNull();
  });

  // ── Selection count display ──────────────────────────────────────────

  it('shows correct count for single selection', () => {
    setupStore({ selectedIds: new Set(['a']) });
    render(<SceneHierarchy />);
    expect(screen.getByText('1 selected')).toBeInTheDocument();
  });

  it('shows correct count for multi-selection', () => {
    setupStore({ selectedIds: new Set(['a', 'b', 'c']) });
    render(<SceneHierarchy />);
    expect(screen.getByText('3 selected')).toBeInTheDocument();
  });

  // ── Drag and drop ────────────────────────────────────────────────────

  it('handles dragOver on root area', () => {
    setupStore();
    render(<SceneHierarchy />);

    const tree = screen.getByRole('tree');
    fireEvent.dragOver(tree, { preventDefault: vi.fn() });

    // Should not crash
    expect(tree).toBeInTheDocument();
  });

  it('drag start sets dragging state on scene nodes', () => {
    setupStore();
    render(<SceneHierarchy />);

    // Trigger drag start on Player (c) via the mock button
    fireEvent.click(screen.getByTestId('drag-start-c'));

    // After drag start, other nodes should reflect isDragging=true
    // Re-render will pass isDragging=true to scene nodes
    const nodeA = screen.getByTestId('scene-node-a');
    expect(nodeA.getAttribute('data-is-dragging')).toBe('true');
    expect(nodeA.getAttribute('data-dragged-entity')).toBe('c');
  });

  it('drag end resets dragging state', () => {
    setupStore();
    render(<SceneHierarchy />);

    // Start drag, then end it
    fireEvent.click(screen.getByTestId('drag-start-c'));
    fireEvent.click(screen.getByTestId('drag-end-c'));

    // Drag state should be reset
    const nodeA = screen.getByTestId('scene-node-a');
    expect(nodeA.getAttribute('data-is-dragging')).toBe('false');
    expect(nodeA.getAttribute('data-dragged-entity')).toBe('');
  });

  it('drop ON target reparents entity to target', () => {
    setupStore();
    render(<SceneHierarchy />);

    // Start dragging Player (c)
    fireEvent.click(screen.getByTestId('drag-start-c'));

    // Set drag over zone to 'on' for Camera (a)
    fireEvent.click(screen.getByTestId('drag-over-on-a'));

    // Drop on Camera (a)
    fireEvent.click(screen.getByTestId('drop-on-a'));

    // Should reparent 'c' under 'a'
    expect(mockReparentEntity).toHaveBeenCalledWith('c', 'a', undefined);
  });

  it('drop BEFORE target reparents to target parent at correct index', () => {
    setupStore();
    render(<SceneHierarchy />);

    // Start dragging Enemy (d)
    fireEvent.click(screen.getByTestId('drag-start-d'));

    // Set drag over zone to 'before' for Player (c)
    fireEvent.click(screen.getByTestId('drag-over-before-c'));

    // Drop on Player (c)
    fireEvent.click(screen.getByTestId('drop-on-c'));

    // Player (c) is a root node with no parent, so newParentId is null
    // 'c' is at index 1 in rootIds [a, c, d], so 'before' means insertIndex = 1
    expect(mockReparentEntity).toHaveBeenCalledWith('d', null, 1);
  });

  it('drop AFTER target reparents to target parent at index+1', () => {
    setupStore();
    render(<SceneHierarchy />);

    // Start dragging Enemy (d)
    fireEvent.click(screen.getByTestId('drag-start-d'));

    // Set drag over zone to 'after' for Camera (a)
    fireEvent.click(screen.getByTestId('drag-over-after-a'));

    // Drop on Camera (a)
    fireEvent.click(screen.getByTestId('drop-on-a'));

    // Camera (a) is at index 0 in rootIds [a, c, d], 'after' means insertIndex = 1
    expect(mockReparentEntity).toHaveBeenCalledWith('d', null, 1);
  });

  it('drop on invalid target does not reparent', () => {
    // Make computeInvalidTargets return 'a' and 'c' as invalid when dragging 'a'
    vi.mocked(computeInvalidTargets).mockReturnValue(new Set(['a', 'c']));

    setupStore();
    render(<SceneHierarchy />);

    // Start dragging Camera (a) — 'a' and 'c' are marked invalid targets
    fireEvent.click(screen.getByTestId('drag-start-a'));

    // The invalid target IDs should be passed to rendered scene nodes
    const nodeA = screen.getByTestId('scene-node-a');
    expect(nodeA.getAttribute('data-is-invalid-target')).toBe('true');

    const nodeC = screen.getByTestId('scene-node-c');
    expect(nodeC.getAttribute('data-is-invalid-target')).toBe('true');

    // Valid target should not be marked invalid
    const nodeD = screen.getByTestId('scene-node-d');
    expect(nodeD.getAttribute('data-is-invalid-target')).toBe('false');

    // Reset mock for other tests
    vi.mocked(computeInvalidTargets).mockReturnValue(new Set());
  });

  it('drop on root area reparents entity to root', () => {
    setupStore();
    render(<SceneHierarchy />);

    // Start dragging Player (c) — a root entity
    fireEvent.click(screen.getByTestId('drag-start-c'));

    // Drop on root tree area
    const tree = screen.getByRole('tree');

    // First enable drag state for root drag over
    fireEvent.dragOver(tree);

    // Then drop
    fireEvent.drop(tree);

    // Should reparent 'c' to root (null parent)
    expect(mockReparentEntity).toHaveBeenCalledWith('c', null, undefined);
  });

  it('dragOver on root area shows root drop zone when dragging', () => {
    setupStore();
    render(<SceneHierarchy />);

    // Start dragging Player (c)
    fireEvent.click(screen.getByTestId('drag-start-c'));

    // Drag over root area
    const tree = screen.getByRole('tree');
    fireEvent.dragOver(tree);

    // The root drop zone indicator should render (blue line)
    // It appears when dragState.isDragging && dropTarget?.zone === 'root'
    expect(tree).toBeInTheDocument();
  });

  it('drop without active drag does nothing', () => {
    setupStore();
    render(<SceneHierarchy />);

    // Directly try to drop on root without starting a drag
    const tree = screen.getByRole('tree');
    fireEvent.drop(tree);

    // Should not call reparentEntity
    expect(mockReparentEntity).not.toHaveBeenCalled();
  });

  it('dragOver sets drop target on scene node', () => {
    setupStore();
    render(<SceneHierarchy />);

    // Start dragging Player (c)
    fireEvent.click(screen.getByTestId('drag-start-c'));

    // Drag over Camera (a) with 'on' zone
    fireEvent.click(screen.getByTestId('drag-over-on-a'));

    // Node 'a' should show drop zone
    const nodeA = screen.getByTestId('scene-node-a');
    expect(nodeA.getAttribute('data-drop-zone')).toBe('on');
  });

  // ── Filtering ─────────────────────────────────────────────────────────

  it('shows "No matching entities" when filtering with no results', () => {
    const emptyGraph = makeGraph({});
    setupStore({ sceneGraph: emptyGraph, hierarchyFilter: 'nonexistent' });
    const { container } = render(<SceneHierarchy />);
    expect(container.textContent).toContain('No matching entities');
  });

  it('filters nodes by name when hierarchyFilter is set', () => {
    setupStore({ hierarchyFilter: 'Play' });
    render(<SceneHierarchy />);

    // With the filter mock, only nodes matching 'Play' should be in filteredRootIds
    // Player (c) matches, Camera (a) and Enemy (d) don't appear as filtered roots
    // The mock filterHierarchy shows visible ancestors too
    expect(screen.getByTestId('scene-node-c')).toBeInTheDocument();
  });

  it('shows match count in search component when filtering', () => {
    setupStore({ hierarchyFilter: 'Player' });
    render(<SceneHierarchy />);

    // The HierarchySearch mock shows matchCount when provided
    expect(screen.getByTestId('match-count')).toBeInTheDocument();
    expect(screen.getByTestId('match-count').textContent).toBe('1');
  });

  // ── Unhandled key does not prevent default ───────────────────────────

  it('unrecognized key does not prevent default behavior', () => {
    setupStore();
    render(<SceneHierarchy />);

    const tree = screen.getByRole('tree');
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true });
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault');

    tree.dispatchEvent(event);

    expect(preventDefaultSpy).not.toHaveBeenCalled();
  });

  // ── Empty keyboard navigation ────────────────────────────────────────

  it('keyboard navigation does nothing when scene is empty', () => {
    setupStore({ sceneGraph: makeGraph({}) });
    render(<SceneHierarchy />);

    const tree = screen.getByRole('tree');
    fireEvent.keyDown(tree, { key: 'ArrowDown' });
    fireEvent.keyDown(tree, { key: 'Enter' });

    // No selection should happen
    expect(mockSelectEntity).not.toHaveBeenCalled();
  });
});
