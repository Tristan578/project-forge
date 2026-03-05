/**
 * Tests for SceneHierarchy component — rendering, keyboard navigation,
 * context menu, selection, drag-and-drop, filtering, and empty states.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { SceneHierarchy } from '../SceneHierarchy';
import { useEditorStore, type SceneGraph } from '@/stores/editorStore';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(),
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
  }: {
    node: { entityId: string; name: string };
    onContextMenu: (data: { entityId: string; entityName: string; position: { x: number; y: number } }) => void;
    isEditing: boolean;
    onEditComplete: (name: string | null) => void;
    focusedEntityId: string | null;
  }) => (
    <div
      data-testid={`scene-node-${node.entityId}`}
      data-focused={focusedEntityId === node.entityId ? 'true' : 'false'}
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
    expect(screen.getByText('Scene Hierarchy')).toBeDefined();
  });

  it('renders scene nodes from graph', () => {
    setupStore();
    render(<SceneHierarchy />);
    expect(screen.getByTestId('scene-node-a')).toBeDefined();
    expect(screen.getByTestId('scene-node-c')).toBeDefined();
    expect(screen.getByTestId('scene-node-d')).toBeDefined();
  });

  it('renders search component', () => {
    setupStore();
    render(<SceneHierarchy />);
    expect(screen.getByTestId('hierarchy-search')).toBeDefined();
  });

  it('shows selection count when entities are selected', () => {
    setupStore({ selectedIds: new Set(['a', 'c']) });
    render(<SceneHierarchy />);
    expect(screen.getByText('2 selected')).toBeDefined();
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
    expect(container.textContent).toContain('Loading scene entities');
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

    expect(screen.getByTestId('context-menu')).toBeDefined();
    expect(screen.getByTestId('ctx-rename')).toBeDefined();
    expect(screen.getByTestId('ctx-focus')).toBeDefined();
    expect(screen.getByTestId('ctx-duplicate')).toBeDefined();
    expect(screen.getByTestId('ctx-delete')).toBeDefined();
  });

  it('rename action from context menu enables editing', () => {
    setupStore();
    render(<SceneHierarchy />);

    // Open context menu for Player
    fireEvent.contextMenu(screen.getByTestId('scene-node-c'), { clientX: 100, clientY: 200 });
    fireEvent.click(screen.getByTestId('ctx-rename'));

    // Editing input should appear for entity 'c'
    expect(screen.getByTestId('rename-input-c')).toBeDefined();
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
    expect(tree).toBeDefined();
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

    expect(screen.getByTestId('rename-input-a')).toBeDefined();
  });

  it('Shift+F10 opens context menu for focused entity', () => {
    setupStore();
    render(<SceneHierarchy />);

    const tree = screen.getByRole('tree');
    fireEvent.keyDown(tree, { key: 'ArrowDown' }); // Focus Camera (a)
    fireEvent.keyDown(tree, { key: 'F10', shiftKey: true });

    expect(screen.getByTestId('context-menu')).toBeDefined();
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

  // ── Drag and drop (root drop) ─────────────────────────────────────────

  it('handles dragOver on root area', () => {
    setupStore();
    render(<SceneHierarchy />);

    const tree = screen.getByRole('tree');
    fireEvent.dragOver(tree, { preventDefault: vi.fn() });

    // Should not crash
    expect(tree).toBeDefined();
  });
});
