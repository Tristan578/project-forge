import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@/test/utils/componentTestUtils';
import { TerrainInspector } from '../TerrainInspector';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(() => ({})),
}));

vi.mock('@/stores/workspaceStore', () => ({
  useWorkspaceStore: vi.fn((selector: (s: unknown) => unknown) => selector({
    navigateDocs: vi.fn(),
  })),
}));

vi.mock('lucide-react', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('lucide-react');
  return Object.fromEntries(Object.keys(actual).map(k => [k, () => null]));
});

vi.mock('@/components/ui/InfoTooltip', () => ({
  InfoTooltip: () => null,
}));

import { useEditorStore } from '@/stores/editorStore';

function mockEditorStore(overrides: Record<string, unknown> = {}) {
  const state: Record<string, unknown> = {
    primaryId: 'terrain-1',
    terrainData: {},
    updateTerrain: vi.fn(),
    sceneGraph: {
      rootIds: ['terrain-1'],
      nodes: {
        'terrain-1': {
          id: 'terrain-1',
          name: 'Terrain',
          parentId: null,
          children: [],
          components: [],
        },
      },
    },
    ...overrides,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.mocked(useEditorStore).mockImplementation((selector: any) => selector(state));
}

describe('TerrainInspector', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('returns null when no terrain data exists for entity', () => {
    mockEditorStore();
    const { container } = render(<TerrainInspector />);
    expect(container.innerHTML).toBe('');
  });

  it('renders terrain settings when terrain data exists', () => {
    mockEditorStore({
      terrainData: {
        'terrain-1': {
          resolution: 64,
          size: 100,
          noiseType: 'perlin',
          octaves: 4,
          frequency: 0.02,
          amplitude: 0.5,
          heightScale: 10,
          seed: 42,
        },
      },
    });
    render(<TerrainInspector />);
    expect(screen.getByText('Terrain')).not.toBeNull();
    expect(screen.getByText('Resolution')).not.toBeNull();
    expect(screen.getByText('Noise')).not.toBeNull();
    expect(screen.getByText('Randomize')).not.toBeNull();
  });

  it('renders terrain when entity has EntityType::Terrain component', () => {
    mockEditorStore({
      sceneGraph: {
        rootIds: ['terrain-1'],
        nodes: {
          'terrain-1': {
            id: 'terrain-1',
            name: 'Terrain',
            parentId: null,
            children: [],
            components: ['EntityType::Terrain'],
          },
        },
      },
      terrainData: {
        'terrain-1': {
          resolution: 128,
          size: 200,
          noiseType: 'simplex',
          octaves: 6,
          frequency: 0.015,
          amplitude: 0.7,
          heightScale: 15,
          seed: 100,
        },
      },
    });
    render(<TerrainInspector />);
    expect(screen.getByText('Terrain')).not.toBeNull();
  });
});
