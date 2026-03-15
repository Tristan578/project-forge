/**
 * Render tests for SceneStatistics component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { SceneStatistics } from '../SceneStatistics';
import { useEditorStore } from '@/stores/editorStore';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(() => ({})),
}));

vi.mock('lucide-react', () => ({
  ChevronDown: (props: Record<string, unknown>) => <span data-testid="chevron-down" {...props} />,
  ChevronRight: (props: Record<string, unknown>) => <span data-testid="chevron-right" {...props} />,
}));

function makeNode(id: string, components: string[] = []) {
  return { id, name: id, components };
}

describe('SceneStatistics', () => {
  function setupStore({
    nodes = {} as Record<string, { id: string; name: string; components: string[] }>,
    allScripts = {} as Record<string, { source: string }>,
    assetRegistry = {} as Record<string, { kind: string }>,
    sprites = {} as Record<string, unknown>,
    sortingLayers = [] as unknown[],
  } = {}) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useEditorStore).mockImplementation((selector: any) => {
      const state = {
        sceneGraph: { nodes },
        allScripts,
        assetRegistry,
        sprites,
        sortingLayers,
      };
      return typeof selector === 'function' ? selector(state) : state;
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders Scene Statistics button', () => {
    setupStore();
    render(<SceneStatistics />);
    expect(screen.getByText('Scene Statistics')).toBeDefined();
  });

  it('shows entity count in summary', () => {
    setupStore({
      nodes: {
        camera: makeNode('camera'),
        player: makeNode('player'),
        enemy: makeNode('enemy'),
      },
    });
    render(<SceneStatistics />);
    expect(screen.getByText('3')).toBeDefined();
  });

  it('shows script count in summary', () => {
    setupStore({
      allScripts: { s1: { source: 'a' }, s2: { source: 'b' } },
    });
    render(<SceneStatistics />);
    expect(screen.getByText('2')).toBeDefined();
  });

  it('shows asset count in summary', () => {
    setupStore({
      assetRegistry: {
        a1: { kind: 'texture' },
        a2: { kind: 'gltf_model' },
      },
    });
    render(<SceneStatistics />);
    expect(screen.getByText('2')).toBeDefined();
  });

  it('is collapsed by default (no breakdown visible)', () => {
    setupStore();
    render(<SceneStatistics />);
    // "Components" heading only shows when expanded
    expect(screen.queryByText('Components')).toBeNull();
  });

  it('shows summary labels always visible', () => {
    setupStore();
    render(<SceneStatistics />);
    expect(screen.getByText('Entities')).toBeDefined();
    expect(screen.getByText('Scripts')).toBeDefined();
    expect(screen.getByText('Assets')).toBeDefined();
  });

  it('expands breakdown when Scene Statistics is clicked', () => {
    setupStore({
      nodes: { p: makeNode('p', ['Light']) },
    });
    render(<SceneStatistics />);
    fireEvent.click(screen.getByText('Scene Statistics'));
    expect(screen.getByText('Components')).toBeDefined();
  });

  it('shows light count in component breakdown when expanded', () => {
    setupStore({
      nodes: {
        e1: makeNode('e1', ['Light']),
        e2: makeNode('e2', ['PointLight']),
      },
    });
    render(<SceneStatistics />);
    fireEvent.click(screen.getByText('Scene Statistics'));
    expect(screen.getByText('Lights')).toBeDefined();
  });

  it('shows texture count in asset breakdown when expanded', () => {
    setupStore({
      assetRegistry: { t1: { kind: 'texture' } },
    });
    render(<SceneStatistics />);
    fireEvent.click(screen.getByText('Scene Statistics'));
    expect(screen.getByText('Textures')).toBeDefined();
  });

  it('collapses again after second click', () => {
    setupStore({
      nodes: { p: makeNode('p', ['Light']) },
    });
    render(<SceneStatistics />);
    fireEvent.click(screen.getByText('Scene Statistics'));
    fireEvent.click(screen.getByText('Scene Statistics'));
    expect(screen.queryByText('Components')).toBeNull();
  });
});
