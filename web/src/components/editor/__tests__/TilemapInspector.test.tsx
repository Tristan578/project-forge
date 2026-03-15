/**
 * Render tests for TilemapInspector component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { TilemapInspector } from '../TilemapInspector';
import { useEditorStore } from '@/stores/editorStore';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(() => ({})),
}));

vi.mock('lucide-react', () => ({
  Plus: (props: Record<string, unknown>) => <span data-testid="plus-icon" {...props} />,
  Trash2: (props: Record<string, unknown>) => <span data-testid="trash-icon" {...props} />,
  Eye: (props: Record<string, unknown>) => <span data-testid="eye-icon" {...props} />,
  EyeOff: (props: Record<string, unknown>) => <span data-testid="eye-off-icon" {...props} />,
  Shield: (props: Record<string, unknown>) => <span data-testid="shield-icon" {...props} />,
}));

const baseTilemapData = {
  tilesetAssetId: '',
  mapSize: [20, 15] as [number, number],
  tileSize: [32, 32] as [number, number],
  layers: [
    { name: 'Layer 1', tiles: Array(20 * 15).fill(null), visible: true, opacity: 1, isCollision: false },
  ],
  origin: 'TopLeft' as const,
};

describe('TilemapInspector', () => {
  const mockSetTilemapData = vi.fn();
  const mockRemoveTilemapData = vi.fn();

  function setupStore({
    primaryId = 'entity-1' as string | null,
    tilemapData = null as typeof baseTilemapData | null,
    tilesets = {} as Record<string, { name: string }>,
    projectType = '2d' as '2d' | '3d',
  } = {}) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useEditorStore).mockImplementation((selector: any) => {
      const tilemaps: Record<string, typeof baseTilemapData> = {};
      if (primaryId && tilemapData) tilemaps[primaryId] = tilemapData;
      const state = {
        primaryId,
        tilemaps,
        tilesets,
        projectType,
        setTilemapData: mockSetTilemapData,
        removeTilemapData: mockRemoveTilemapData,
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
    setupStore({ projectType: '3d' });
    const { container } = render(<TilemapInspector />);
    expect(container.firstChild).toBeNull();
  });

  it('renders Tilemap heading in 2D project', () => {
    setupStore();
    render(<TilemapInspector />);
    expect(screen.getByText('Tilemap')).toBeDefined();
  });

  it('shows Add Tilemap button when no tilemap data', () => {
    setupStore();
    render(<TilemapInspector />);
    expect(screen.getByText('Add Tilemap')).toBeDefined();
  });

  it('calls setTilemapData with defaults when Add Tilemap clicked', () => {
    setupStore();
    render(<TilemapInspector />);
    fireEvent.click(screen.getByText('Add Tilemap'));
    expect(mockSetTilemapData).toHaveBeenCalledWith(
      'entity-1',
      expect.objectContaining({ mapSize: [20, 15], tileSize: [32, 32] })
    );
  });

  it('shows tilemap controls when data exists', () => {
    setupStore({ tilemapData: baseTilemapData });
    render(<TilemapInspector />);
    expect(screen.getByText('Tileset')).toBeDefined();
  });

  it('renders Map Size label', () => {
    setupStore({ tilemapData: baseTilemapData });
    render(<TilemapInspector />);
    expect(screen.getByText('Map Size (tiles)')).toBeDefined();
  });

  it('renders tileset select with None option', () => {
    setupStore({ tilemapData: baseTilemapData });
    render(<TilemapInspector />);
    expect(screen.getByRole('option', { name: 'None' })).toBeDefined();
  });

  it('shows available tilesets in select', () => {
    setupStore({
      tilemapData: baseTilemapData,
      tilesets: { 'ts-1': { name: 'Dungeon Tiles' } },
    });
    render(<TilemapInspector />);
    expect(screen.getByText('Dungeon Tiles')).toBeDefined();
  });

  it('shows tile size as read-only', () => {
    setupStore({ tilemapData: baseTilemapData });
    render(<TilemapInspector />);
    expect(screen.getByText('Tile Size (px)')).toBeDefined();
    expect(screen.getByText('32 × 32')).toBeDefined();
  });

  it('shows Layer 1 name input in layers list', () => {
    setupStore({ tilemapData: baseTilemapData });
    render(<TilemapInspector />);
    // Layer name is rendered as an input value
    const inputs = screen.getAllByRole('textbox');
    const layerInput = inputs.find((inp) => (inp as HTMLInputElement).value === 'Layer 1');
    expect(layerInput).toBeDefined();
  });

  it('renders Add Layer button with title', () => {
    setupStore({ tilemapData: baseTilemapData });
    render(<TilemapInspector />);
    expect(screen.getByTitle('Add Layer')).toBeDefined();
  });

  it('calls setTilemapData with new layer when Add Layer clicked', () => {
    setupStore({ tilemapData: baseTilemapData });
    render(<TilemapInspector />);
    fireEvent.click(screen.getByTitle('Add Layer'));
    expect(mockSetTilemapData).toHaveBeenCalledWith(
      'entity-1',
      expect.objectContaining({
        layers: expect.arrayContaining([
          expect.objectContaining({ name: 'Layer 2' }),
        ]),
      })
    );
  });

  it('shows Remove Tilemap button', () => {
    setupStore({ tilemapData: baseTilemapData });
    render(<TilemapInspector />);
    expect(screen.getByText('Remove Tilemap')).toBeDefined();
  });

  it('calls removeTilemapData when Remove Tilemap confirmed', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    setupStore({ tilemapData: baseTilemapData });
    render(<TilemapInspector />);
    fireEvent.click(screen.getByText('Remove Tilemap'));
    expect(mockRemoveTilemapData).toHaveBeenCalledWith('entity-1');
  });
});
