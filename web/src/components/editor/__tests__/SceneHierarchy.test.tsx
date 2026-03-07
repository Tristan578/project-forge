import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@/test/utils/componentTestUtils';
import { SceneHierarchy, flattenVisibleNodes } from '../SceneHierarchy';
import type { SceneGraph } from '@/stores/editorStore';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(),
}));

vi.mock('lucide-react', () => {
  const stub = () => null;
  return new Proxy({ __esModule: true }, {
    get: (target, name) => (name in target ? (target as Record<string, unknown>)[name as string] : stub),
  });
});

vi.mock('@/hooks/useEngine', () => ({
  getWasmModule: vi.fn(() => null),
}));

vi.mock('../SceneNode', () => ({
  SceneNode: ({ node }: { node: { id: string; name: string } }) => (
    <div data-testid={`scene-node-${node.id}`}>{node.name}</div>
  ),
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
    expect(screen.getByText('Scene Hierarchy')).toBeDefined();
  });

  it('shows loading skeleton when no entities exist', () => {
    mockEditorStore();
    render(<SceneHierarchy />);
    expect(screen.getByText('Loading scene entities...')).toBeDefined();
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
    expect(screen.getByText('2 selected')).toBeDefined();
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
