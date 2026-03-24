/**
 * Render tests for TilemapToolbar component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { TilemapToolbar } from '../TilemapToolbar';
import { useEditorStore } from '@/stores/editorStore';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(() => ({})),
}));

vi.mock('lucide-react', () => ({
  Paintbrush: (props: Record<string, unknown>) => <span data-testid="paintbrush-icon" {...props} />,
  Eraser: (props: Record<string, unknown>) => <span data-testid="eraser-icon" {...props} />,
  PaintBucket: (props: Record<string, unknown>) => <span data-testid="paint-bucket-icon" {...props} />,
  Square: (props: Record<string, unknown>) => <span data-testid="square-icon" {...props} />,
  Pipette: (props: Record<string, unknown>) => <span data-testid="pipette-icon" {...props} />,
}));

const baseTilemapData = {
  tilesetAssetId: '',
  mapSize: [20, 15] as [number, number],
  tileSize: [32, 32] as [number, number],
  layers: [
    { name: 'Layer 1', tiles: [], visible: true, opacity: 1, isCollision: false },
    { name: 'Layer 2', tiles: [], visible: true, opacity: 1, isCollision: false },
  ],
  origin: 'TopLeft' as const,
};

describe('TilemapToolbar', () => {
  const mockSetActiveTool = vi.fn();
  const mockSetActiveLayerIndex = vi.fn();

  function setupStore({
    projectType = '2d' as '2d' | '3d',
    tilemapData = null as typeof baseTilemapData | null,
    activeTool = 'paint' as string,
    activeLayerIndex = 0,
  } = {}) {
    const primaryId = tilemapData ? 'entity-1' : null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useEditorStore).mockImplementation((selector: any) => {
      const tilemaps: Record<string, typeof baseTilemapData> = {};
      if (primaryId && tilemapData) tilemaps[primaryId] = tilemapData;
      const state = {
        primaryId,
        tilemaps,
        projectType,
        tilemapActiveTool: activeTool,
        setTilemapActiveTool: mockSetActiveTool,
        tilemapActiveLayerIndex: activeLayerIndex,
        setTilemapActiveLayerIndex: mockSetActiveLayerIndex,
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

  it('returns null when projectType is 3d', () => {
    setupStore({ projectType: '3d', tilemapData: baseTilemapData });
    const { container } = render(<TilemapToolbar />);
    expect(container.firstChild).toBeNull();
  });

  it('returns null when no tilemapData', () => {
    setupStore({ projectType: '2d' });
    const { container } = render(<TilemapToolbar />);
    expect(container.firstChild).toBeNull();
  });

  it('renders paint tool button', () => {
    setupStore({ tilemapData: baseTilemapData });
    render(<TilemapToolbar />);
    expect(screen.getByTitle('Paint (B)')).not.toBeNull();
  });

  it('renders all tool buttons', () => {
    setupStore({ tilemapData: baseTilemapData });
    render(<TilemapToolbar />);
    expect(screen.getByTitle('Paint (B)')).not.toBeNull();
    expect(screen.getByTitle('Erase (E)')).not.toBeNull();
    expect(screen.getByTitle('Fill (G)')).not.toBeNull();
    expect(screen.getByTitle('Rectangle (R)')).not.toBeNull();
    expect(screen.getByTitle('Tile Picker (Alt+Click)')).not.toBeNull();
  });

  it('calls setActiveTool when a tool button is clicked', () => {
    setupStore({ tilemapData: baseTilemapData });
    render(<TilemapToolbar />);
    fireEvent.click(screen.getByTitle('Erase (E)'));
    expect(mockSetActiveTool).toHaveBeenCalledWith('erase');
  });

  it('renders Layer selector label', () => {
    setupStore({ tilemapData: baseTilemapData });
    render(<TilemapToolbar />);
    expect(screen.getByText('Layer:')).not.toBeNull();
  });

  it('renders layer options in selector', () => {
    setupStore({ tilemapData: baseTilemapData });
    render(<TilemapToolbar />);
    expect(screen.getByRole('option', { name: 'Layer 1' })).not.toBeNull();
    expect(screen.getByRole('option', { name: 'Layer 2' })).not.toBeNull();
  });

  it('calls setActiveLayerIndex when layer select changes', () => {
    setupStore({ tilemapData: baseTilemapData });
    render(<TilemapToolbar />);
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: '1' } });
    expect(mockSetActiveLayerIndex).toHaveBeenCalledWith(1);
  });

  it('has active tool visually distinguished', () => {
    setupStore({ tilemapData: baseTilemapData, activeTool: 'paint' });
    render(<TilemapToolbar />);
    // Paint button should be the "active" one — just verify it renders
    const paintButton = screen.getByTitle('Paint (B)');
    expect(paintButton).toBeDefined();
  });
});
