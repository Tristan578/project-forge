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
    expect(screen.getByText('Scene Statistics')).toBeInTheDocument();
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
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('shows script count in summary', () => {
    setupStore({
      allScripts: { s1: { source: 'a' }, s2: { source: 'b' } },
    });
    render(<SceneStatistics />);
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('shows asset count in summary', () => {
    setupStore({
      assetRegistry: {
        a1: { kind: 'texture' },
        a2: { kind: 'gltf_model' },
      },
    });
    render(<SceneStatistics />);
    expect(screen.getByText('2')).toBeInTheDocument();
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
    expect(screen.getByText('Entities')).toBeInTheDocument();
    expect(screen.getByText('Scripts')).toBeInTheDocument();
    expect(screen.getByText('Assets')).toBeInTheDocument();
  });

  it('expands breakdown when Scene Statistics is clicked', () => {
    setupStore({
      nodes: { p: makeNode('p', ['PointLight']) },
    });
    render(<SceneStatistics />);
    fireEvent.click(screen.getByText('Scene Statistics'));
    expect(screen.getByText('Components')).toBeInTheDocument();
  });

  it('shows light count in component breakdown when expanded', () => {
    setupStore({
      nodes: {
        e1: makeNode('e1', ['DirectionalLight']),
        e2: makeNode('e2', ['PointLight']),
      },
    });
    render(<SceneStatistics />);
    fireEvent.click(screen.getByText('Scene Statistics'));
    expect(screen.getByText('Lights')).toBeInTheDocument();
  });

  // The component names below are the exact strings `detect_components` in
  // `engine/src/core/scene_graph.rs` emits. They are a wire contract: the node
  // payload carries no entity-type field, so a counter keyed on an invented
  // name (`'Physics'`, `'Audio'`, `'Particle'`, `'GameComponent'`) can only
  // ever report zero. Every name asserted here must exist on that side.
  describe('component breakdown keys on the engine-emitted names', () => {
    /** Reads the number rendered next to a breakdown row label. */
    function rowValue(label: string): string | null {
      const row = screen.getByText(label).parentElement;
      return row?.querySelector('span:last-child')?.textContent ?? null;
    }

    function renderExpanded(nodes: Record<string, { id: string; name: string; components: string[] }>) {
      setupStore({ nodes });
      render(<SceneStatistics />);
      fireEvent.click(screen.getByText('Scene Statistics'));
    }

    it('counts physics bodies', () => {
      renderExpanded({
        a: makeNode('a', ['PhysicsData', 'PhysicsEnabled']),
        b: makeNode('b', ['PhysicsEnabled']),
        c: makeNode('c', ['Mesh3d']),
      });
      expect(rowValue('Physics Bodies')).toBe('2');
    });

    it('counts audio sources', () => {
      renderExpanded({
        a: makeNode('a', ['AudioData', 'AudioEnabled']),
        b: makeNode('b', ['AudioData']),
      });
      expect(rowValue('Audio Sources')).toBe('2');
    });

    it('counts particle emitters', () => {
      renderExpanded({
        a: makeNode('a', ['ParticleData', 'ParticleEnabled']),
      });
      expect(rowValue('Particles')).toBe('1');
    });

    it('counts game components', () => {
      renderExpanded({
        a: makeNode('a', ['GameComponents']),
        b: makeNode('b', ['GameComponents', 'ScriptData']),
      });
      expect(rowValue('Game Components')).toBe('2');
    });

    it('counts each light entity once regardless of light type', () => {
      renderExpanded({
        a: makeNode('a', ['PointLight']),
        b: makeNode('b', ['DirectionalLight']),
        c: makeNode('c', ['SpotLight']),
      });
      expect(rowValue('Lights')).toBe('3');
    });

    it('does not count an entity twice when it carries both the data and marker component', () => {
      // `PhysicsData` and `PhysicsEnabled` describe one body. A per-name tally
      // would report two.
      renderExpanded({ solo: makeNode('solo', ['PhysicsData', 'PhysicsEnabled']) });
      expect(rowValue('Physics Bodies')).toBe('1');
    });

    it('reports nothing for names the engine never emits', () => {
      renderExpanded({ a: makeNode('a', ['Physics', 'Audio', 'Particle', 'GameComponent']) });
      expect(screen.queryByText('Physics Bodies')).toBeNull();
      expect(screen.queryByText('Audio Sources')).toBeNull();
      expect(screen.queryByText('Particles')).toBeNull();
      expect(screen.queryByText('Game Components')).toBeNull();
    });
  });

  it('shows texture count in asset breakdown when expanded', () => {
    setupStore({
      assetRegistry: { t1: { kind: 'texture' } },
    });
    render(<SceneStatistics />);
    fireEvent.click(screen.getByText('Scene Statistics'));
    expect(screen.getByText('Textures')).toBeInTheDocument();
  });

  it('collapses again after second click', () => {
    setupStore({
      nodes: { p: makeNode('p', ['PointLight']) },
    });
    render(<SceneStatistics />);
    fireEvent.click(screen.getByText('Scene Statistics'));
    fireEvent.click(screen.getByText('Scene Statistics'));
    expect(screen.queryByText('Components')).toBeNull();
  });
});
