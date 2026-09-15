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

const mockConfirm = vi.fn().mockResolvedValue(true);
vi.mock('@/hooks/useConfirmDialog', () => ({
  useConfirmDialog: () => ({
    confirm: mockConfirm,
    ConfirmDialogPortal: () => null,
  }),
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
  const mockSetTileCollisionShape = vi.fn();

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
        setTileCollisionShape: mockSetTileCollisionShape,
      };
      return typeof selector === 'function' ? selector(state) : state;
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: the store reports the cell was written. Individual tests that
    // exercise the refused-write path override this with mockReturnValue(false).
    mockSetTileCollisionShape.mockReturnValue(true);
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
    expect(screen.getByText('Tilemap')).toBeInTheDocument();
  });

  it('shows Add Tilemap button when no tilemap data', () => {
    setupStore();
    render(<TilemapInspector />);
    expect(screen.getByText('Add Tilemap')).toBeInTheDocument();
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
    expect(screen.getByText('Tileset')).toBeInTheDocument();
  });

  it('renders Map Size label', () => {
    setupStore({ tilemapData: baseTilemapData });
    render(<TilemapInspector />);
    expect(screen.getByText('Map Size (tiles)')).toBeInTheDocument();
  });

  it('renders tileset select with None option', () => {
    setupStore({ tilemapData: baseTilemapData });
    render(<TilemapInspector />);
    expect(screen.getByRole('option', { name: 'None' })).toBeInTheDocument();
  });

  it('shows available tilesets in select', () => {
    setupStore({
      tilemapData: baseTilemapData,
      tilesets: { 'ts-1': { name: 'Dungeon Tiles' } },
    });
    render(<TilemapInspector />);
    expect(screen.getByText('Dungeon Tiles')).toBeInTheDocument();
  });

  it('shows tile size as read-only', () => {
    setupStore({ tilemapData: baseTilemapData });
    render(<TilemapInspector />);
    expect(screen.getByText('Tile Size (px)')).toBeInTheDocument();
    expect(screen.getByText('32 × 32')).toBeInTheDocument();
  });

  it('shows Layer 1 name input in layers list', () => {
    setupStore({ tilemapData: baseTilemapData });
    render(<TilemapInspector />);
    // Layer name is rendered as an input value
    const inputs = screen.getAllByRole('textbox');
    const layerInput = inputs.find((inp) => (inp as HTMLInputElement).value === 'Layer 1');
    expect(layerInput).toBeInTheDocument();
  });

  it('renders Add Layer button with title', () => {
    setupStore({ tilemapData: baseTilemapData });
    render(<TilemapInspector />);
    expect(screen.getByTitle('Add Layer')).toBeInTheDocument();
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
    expect(screen.getByText('Remove Tilemap')).toBeInTheDocument();
  });

  it('calls removeTilemapData when Remove Tilemap confirmed', async () => {
    mockConfirm.mockResolvedValue(true);
    setupStore({ tilemapData: baseTilemapData });
    render(<TilemapInspector />);
    fireEvent.click(screen.getByText('Remove Tilemap'));
    await vi.waitFor(() => {
      expect(mockRemoveTilemapData).toHaveBeenCalledWith('entity-1');
    });
  });

  // OP-04: per-tile collision shape picker
  it('renders the collision shape picker with every shape option', () => {
    setupStore({ tilemapData: baseTilemapData });
    render(<TilemapInspector />);
    expect(screen.getByText('Tile Collision Shape')).toBeInTheDocument();
    const shapeSelect = screen.getByRole('combobox', { name: 'Collision shape' });
    const values = Array.from(shapeSelect.querySelectorAll('option')).map((o) => (o as HTMLOptionElement).value);
    expect(values).toEqual(['none', 'full', 'halfTop', 'halfBottom', 'slopeLeft', 'slopeRight']);
  });

  it('dispatches setTileCollisionShape with the chosen cell and shape on Apply', () => {
    setupStore({ tilemapData: baseTilemapData });
    render(<TilemapInspector />);

    fireEvent.change(screen.getByLabelText('X'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Y'), { target: { value: '5' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Collision shape' }), {
      target: { value: 'halfTop' },
    });
    fireEvent.click(screen.getByText('Apply Collision Shape'));

    expect(mockSetTileCollisionShape).toHaveBeenCalledWith('entity-1', 0, 3, 5, 'halfTop');
  });

  it('offers no invalid shape option in the picker (only the known vocabulary)', () => {
    setupStore({ tilemapData: baseTilemapData });
    render(<TilemapInspector />);
    const shapeSelect = screen.getByRole('combobox', { name: 'Collision shape' }) as HTMLSelectElement;
    const values = Array.from(shapeSelect.querySelectorAll('option')).map((o) => (o as HTMLOptionElement).value);
    expect(values).not.toContain('wedge');
    expect(values).not.toContain('');
  });

  // OP-04: the X/Y inputs' min/max are advisory HTML hints; a value typed past
  // the map bounds still reaches state, so Apply must surface the rejection
  // instead of no-op'ing silently — parity with the chat handler's error.
  it('shows an actionable error and does not dispatch when X is past the map width', () => {
    setupStore({ tilemapData: baseTilemapData });
    render(<TilemapInspector />);

    fireEvent.change(screen.getByLabelText('X'), { target: { value: '25' } });
    fireEvent.change(screen.getByLabelText('Y'), { target: { value: '5' } });
    fireEvent.click(screen.getByText('Apply Collision Shape'));

    expect(mockSetTileCollisionShape).not.toHaveBeenCalled();
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Tile (25, 5) is outside the 20x15 map');
    expect(alert).toHaveAttribute('aria-live', 'polite');
  });

  it('shows an actionable error and does not dispatch when Y is past the map height', () => {
    setupStore({ tilemapData: baseTilemapData });
    render(<TilemapInspector />);

    fireEvent.change(screen.getByLabelText('X'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Y'), { target: { value: '30' } });
    fireEvent.click(screen.getByText('Apply Collision Shape'));

    expect(mockSetTileCollisionShape).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Tile (3, 30) is outside the 20x15 map');
  });

  it('surfaces the store no-op when the write is refused (map larger than tiles)', () => {
    mockSetTileCollisionShape.mockReturnValue(false);
    setupStore({ tilemapData: baseTilemapData });
    render(<TilemapInspector />);

    fireEvent.change(screen.getByLabelText('X'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Y'), { target: { value: '5' } });
    fireEvent.click(screen.getByText('Apply Collision Shape'));

    // Bounds pass, so the store IS called — and its `false` return (a cell it
    // refused to write) is what drives the error, not the component's own guard.
    expect(mockSetTileCollisionShape).toHaveBeenCalledWith('entity-1', 0, 3, 5, 'full');
    expect(screen.getByRole('alert')).toHaveTextContent('Tile (3, 5) could not be updated');
  });

  it('clears a prior error after a subsequent valid Apply succeeds', () => {
    setupStore({ tilemapData: baseTilemapData });
    render(<TilemapInspector />);

    // First: an out-of-bounds click raises the error.
    fireEvent.change(screen.getByLabelText('X'), { target: { value: '25' } });
    fireEvent.click(screen.getByText('Apply Collision Shape'));
    expect(screen.getByRole('alert')).toBeInTheDocument();

    // Then: an in-bounds click clears it (store default returns true).
    fireEvent.change(screen.getByLabelText('X'), { target: { value: '3' } });
    fireEvent.click(screen.getByText('Apply Collision Shape'));
    expect(mockSetTileCollisionShape).toHaveBeenCalledWith('entity-1', 0, 3, 0, 'full');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
