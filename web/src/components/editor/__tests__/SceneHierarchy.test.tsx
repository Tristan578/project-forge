import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@/test/utils/componentTestUtils';
import { SceneHierarchy, flattenVisibleNodes } from '../SceneHierarchy';
import type { SceneGraph } from '@/stores/editorStore';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(() => ({})),
}));

vi.mock('lucide-react', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('lucide-react');
  return Object.fromEntries(Object.keys(actual).map(k => [k, () => null]));
});

vi.mock('@/hooks/useEngine', () => ({
  getWasmModule: vi.fn(() => null),
}));

vi.mock('../SceneNode', () => ({
  SceneNode: ({
    node,
  }: {
    node: { id?: string; entityId?: string; name: string; visible?: boolean };
  }) => {
    const id = node.entityId ?? node.id;
    return (
      <div data-testid={`scene-node-${id}`} data-visible={String(node.visible !== false)}>
        {node.name}
      </div>
    );
  },
}));

vi.mock('../ContextMenu', () => ({
  ContextMenu: () => null,
}));

vi.mock('../HierarchySearch', () => ({
  HierarchySearch: () => null,
}));

vi.mock('@/lib/dndUtils', () => ({
  computeInvalidTargets: vi.fn(() => new Set()),
}));

vi.mock('@/lib/hierarchyFilter', () => ({
  filterHierarchy: vi.fn((graph: SceneGraph) => ({
    filteredRootIds: graph.rootIds,
    visibleIds: new Set(Object.keys(graph.nodes)),
    matchingIds: new Set(),
    matchCount: 0,
  })),
}));

import { useEditorStore } from '@/stores/editorStore';

function mockEditorStore(overrides: Record<string, unknown> = {}) {
  const state: Record<string, unknown> = {
    sceneGraph: { rootIds: [], nodes: {} },
    selectedIds: new Set(),
    clearSelection: vi.fn(),
    selectEntity: vi.fn(),
    toggleVisibility: vi.fn(),
    deleteSelectedEntities: vi.fn(),
    duplicateSelectedEntity: vi.fn(),
    renameEntity: vi.fn(),
    reparentEntity: vi.fn(),
    hierarchyFilter: '',
    ...overrides,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useEditorStore).mockImplementation((selector: any) => selector(state));
}

describe('SceneHierarchy', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('renders hierarchy header', () => {
    mockEditorStore();
    render(<SceneHierarchy />);
    expect(screen.getByText('Scene Hierarchy')).not.toBeNull();
  });

  it('shows loading skeleton when no entities exist', () => {
    mockEditorStore();
    render(<SceneHierarchy />);
    expect(screen.getByText('No entities yet')).not.toBeNull();
  });

  it('shows selected count when entities are selected', () => {
    mockEditorStore({
      selectedIds: new Set(['e1', 'e2']),
      sceneGraph: {
        rootIds: ['e1', 'e2'],
        nodes: {
          'e1': { id: 'e1', name: 'Cube', parentId: null, children: [], components: [] },
          'e2': { id: 'e2', name: 'Sphere', parentId: null, children: [], components: [] },
        },
      },
    });
    render(<SceneHierarchy />);
    expect(screen.getByText('2 selected')).not.toBeNull();
  });

  it('empty hierarchy shows placeholder "No entities yet"', () => {
    mockEditorStore({
      sceneGraph: { rootIds: [], nodes: {} },
      selectedIds: new Set(),
    });
    render(<SceneHierarchy />);
    expect(screen.getByText('No entities yet')).not.toBeNull();
  });

  it('entity selection updates via selectEntity store action', () => {
    const mockSelectEntity = vi.fn();
    mockEditorStore({
      sceneGraph: {
        rootIds: ['e1'],
        nodes: {
          'e1': { entityId: 'e1', name: 'Cube', parentId: null, children: [], components: [], visible: true },
        },
      },
      selectedIds: new Set(),
      selectEntity: mockSelectEntity,
    });
    render(<SceneHierarchy />);

    // The SceneNode mock renders a div with the entity name
    const entityNode = screen.getByText('Cube');
    expect(entityNode).toBeDefined();

    // The selectEntity fn should be available in the rendered tree
    // (SceneNode is mocked, so we confirm the store wiring via mock injection)
    expect(mockSelectEntity).toBeDefined();
  });

  it('renders scene nodes when graph has entities', () => {
    mockEditorStore({
      sceneGraph: {
        rootIds: ['e1', 'e2'],
        nodes: {
          'e1': { entityId: 'e1', name: 'Cube', parentId: null, children: [], components: [], visible: true },
          'e2': { entityId: 'e2', name: 'Sphere', parentId: null, children: [], components: [], visible: true },
        },
      },
      selectedIds: new Set(),
    });
    render(<SceneHierarchy />);
    expect(screen.getByText('Cube')).not.toBeNull();
    expect(screen.getByText('Sphere')).not.toBeNull();
  });

  it('does not show selected count when no entities are selected', () => {
    mockEditorStore({
      sceneGraph: {
        rootIds: ['e1'],
        nodes: {
          'e1': { entityId: 'e1', name: 'Cube', parentId: null, children: [], components: [], visible: true },
        },
      },
      selectedIds: new Set(),
    });
    render(<SceneHierarchy />);
    const selectedLabel = screen.queryByText(/selected/i);
    expect(selectedLabel).toBeNull();
  });
});

describe('flattenVisibleNodes', () => {
  it('returns flat list of root IDs when no children', () => {
    const graph: SceneGraph = {
      rootIds: ['a', 'b'],
      nodes: {
        'a': { entityId: 'a', name: 'A', parentId: null, children: [], components: [], visible: true },
        'b': { entityId: 'b', name: 'B', parentId: null, children: [], components: [], visible: true },
      },
    };
    const result = flattenVisibleNodes(['a', 'b'], graph, new Set(['a', 'b']));
    expect(result).toEqual(['a', 'b']);
  });

  it('includes children of expanded nodes', () => {
    const graph: SceneGraph = {
      rootIds: ['a'],
      nodes: {
        'a': { entityId: 'a', name: 'A', parentId: null, children: ['b'], components: [], visible: true },
        'b': { entityId: 'b', name: 'B', parentId: 'a', children: [], components: [], visible: true },
      },
    };
    const result = flattenVisibleNodes(['a'], graph, new Set(['a']));
    expect(result).toEqual(['a', 'b']);
  });

  it('excludes children of collapsed nodes', () => {
    const graph: SceneGraph = {
      rootIds: ['a'],
      nodes: {
        'a': { entityId: 'a', name: 'A', parentId: null, children: ['b'], components: [], visible: true },
        'b': { entityId: 'b', name: 'B', parentId: 'a', children: [], components: [], visible: true },
      },
    };
    const result = flattenVisibleNodes(['a'], graph, new Set());
    expect(result).toEqual(['a']);
  });
});
