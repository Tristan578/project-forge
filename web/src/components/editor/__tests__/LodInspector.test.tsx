/**
 * Render tests for LodInspector component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { LodInspector } from '../LodInspector';
import { useEditorStore, getCommandDispatcher } from '@/stores/editorStore';
import { usePerformanceStore } from '@/stores/performanceStore';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(() => ({})),
  getCommandDispatcher: vi.fn(),
}));

vi.mock('@/stores/performanceStore', () => ({
  usePerformanceStore: vi.fn(() => ({})),
}));

const meshEntity = {
  entityId: 'entity-1',
  name: 'Cube',
  components: ['Mesh3d', 'Transform'],
  children: [],
};

describe('LodInspector', () => {
  const mockDispatch = vi.fn();

  function setupStore({
    selectedIds = new Set(['entity-1']),
    sceneGraph = {
      nodes: { 'entity-1': meshEntity } as Record<string, typeof meshEntity>,
      rootIds: ['entity-1'] as string[],
    },
    lodLevels = {} as Record<string, number>,
  } = {}) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useEditorStore).mockImplementation((selector: any) => {
      const state = { selectedIds, sceneGraph };
      return typeof selector === 'function' ? selector(state) : state;
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(usePerformanceStore).mockImplementation((selector: any) => {
      const state = { lodLevels };
      return typeof selector === 'function' ? selector(state) : state;
    });
    vi.mocked(getCommandDispatcher).mockReturnValue(mockDispatch);
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('returns null when no entity selected', () => {
    setupStore({
      selectedIds: new Set(),
      sceneGraph: { nodes: {}, rootIds: [] },
    });
    const { container } = render(<LodInspector />);
    expect(container.firstChild).toBeNull();
  });

  it('returns null for non-mesh entity', () => {
    setupStore({
      sceneGraph: {
        nodes: {
          'entity-1': {
            entityId: 'entity-1',
            name: 'Light',
            components: ['PointLight'],
            children: [],
          },
        },
        rootIds: ['entity-1'],
      },
    });
    const { container } = render(<LodInspector />);
    expect(container.firstChild).toBeNull();
  });

  it('renders LOD heading for mesh entity', () => {
    setupStore();
    render(<LodInspector />);
    expect(screen.getByText('LOD (Level of Detail)')).toBeDefined();
  });

  it('renders Auto-generate LODs checkbox', () => {
    setupStore();
    render(<LodInspector />);
    expect(screen.getByText('Auto-generate LODs')).toBeDefined();
  });

  it('renders LOD distance labels', () => {
    setupStore();
    render(<LodInspector />);
    expect(screen.getByText('LOD1 Distance')).toBeDefined();
    expect(screen.getByText('LOD2 Distance')).toBeDefined();
    expect(screen.getByText('LOD3 Distance')).toBeDefined();
  });

  it('renders LOD quality labels', () => {
    setupStore();
    render(<LodInspector />);
    expect(screen.getByText(/LOD1 Quality/)).toBeDefined();
    expect(screen.getByText(/LOD2 Quality/)).toBeDefined();
    expect(screen.getByText(/LOD3 Quality/)).toBeDefined();
  });

  it('renders Simplification Algorithm select', () => {
    setupStore();
    render(<LodInspector />);
    expect(screen.getByText('Simplification Algorithm')).toBeDefined();
    expect(screen.getByRole('option', { name: /QEM/ })).toBeDefined();
    expect(screen.getByRole('option', { name: /Fast/ })).toBeDefined();
  });

  it('renders Generate LOD Meshes button', () => {
    setupStore();
    render(<LodInspector />);
    expect(screen.getByText('Generate LOD Meshes')).toBeDefined();
  });

  it('shows Current LOD level', () => {
    setupStore({ lodLevels: { 'entity-1': 0 } });
    render(<LodInspector />);
    expect(screen.getByText(/Current LOD: Level 0/)).toBeDefined();
    expect(screen.getByText(/Full/)).toBeDefined();
  });

  it('dispatches set_lod and generate_lods when Generate clicked', () => {
    setupStore();
    render(<LodInspector />);
    fireEvent.click(screen.getByText('Generate LOD Meshes'));
    expect(mockDispatch).toHaveBeenCalledWith('set_lod', expect.objectContaining({ entityId: 'entity-1' }));
    expect(mockDispatch).toHaveBeenCalledWith('generate_lods', { entityId: 'entity-1' });
  });

  it('shows status message after generating LODs', () => {
    setupStore();
    render(<LodInspector />);
    fireEvent.click(screen.getByText('Generate LOD Meshes'));
    expect(screen.getByText(/LOD meshes generated/)).toBeDefined();
  });

  it('dispatches set_simplification_backend when algorithm changed', () => {
    setupStore();
    render(<LodInspector />);
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'fast' } });
    expect(mockDispatch).toHaveBeenCalledWith('set_simplification_backend', { backend: 'fast' });
  });
});
