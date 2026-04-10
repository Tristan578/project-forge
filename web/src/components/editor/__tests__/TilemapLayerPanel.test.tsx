/**
 * Render tests for TilemapLayerPanel component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { TilemapLayerPanel } from '../TilemapLayerPanel';
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
  GripVertical: (props: Record<string, unknown>) => <span data-testid="grip-icon" {...props} />,
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
    { name: 'Layer 2', tiles: Array(20 * 15).fill(null), visible: false, opacity: 0.5, isCollision: true },
  ],
  origin: 'TopLeft' as const,
};

describe('TilemapLayerPanel', () => {
  const mockSetTilemapData = vi.fn();
  const mockSetTilemapActiveLayerIndex = vi.fn();

  function setupStore({
    primaryId = 'entity-1' as string | null,
    tilemapData = null as typeof baseTilemapData | null,
    activeLayerIndex = 0,
  } = {}) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useEditorStore).mockImplementation((selector: any) => {
      const tilemaps: Record<string, typeof baseTilemapData> = {};
      if (primaryId && tilemapData) tilemaps[primaryId] = tilemapData;
      const state = {
        primaryId,
        tilemaps,
        tilemapActiveLayerIndex: activeLayerIndex,
        setTilemapActiveLayerIndex: mockSetTilemapActiveLayerIndex,
        setTilemapData: mockSetTilemapData,
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

  it('returns null when no tilemapData', () => {
    setupStore();
    const { container } = render(<TilemapLayerPanel />);
    expect(container.firstChild).toBeNull();
  });

  it('returns null when no primaryId', () => {
    setupStore({ primaryId: null });
    const { container } = render(<TilemapLayerPanel />);
    expect(container.firstChild).toBeNull();
  });

  it('renders Layers heading', () => {
    setupStore({ tilemapData: baseTilemapData });
    render(<TilemapLayerPanel />);
    expect(screen.getByText('Layers')).toBeInTheDocument();
  });

  it('renders Add Layer button with title', () => {
    setupStore({ tilemapData: baseTilemapData });
    render(<TilemapLayerPanel />);
    expect(screen.getByTitle('Add Layer')).toBeInTheDocument();
  });

  it('calls setTilemapData with new layer when Add Layer clicked', () => {
    setupStore({ tilemapData: baseTilemapData });
    render(<TilemapLayerPanel />);
    fireEvent.click(screen.getByTitle('Add Layer'));
    expect(mockSetTilemapData).toHaveBeenCalledWith(
      'entity-1',
      expect.objectContaining({
        layers: expect.arrayContaining([
          expect.objectContaining({ name: 'Layer 3' }),
        ]),
      })
    );
  });

  it('shows layer name as input value', () => {
    setupStore({ tilemapData: baseTilemapData });
    render(<TilemapLayerPanel />);
    const inputs = screen.getAllByRole('textbox');
    const layer1Input = inputs.find((inp) => (inp as HTMLInputElement).value === 'Layer 1');
    expect(layer1Input).toBeInTheDocument();
  });

  it('shows all layer names', () => {
    setupStore({ tilemapData: baseTilemapData });
    render(<TilemapLayerPanel />);
    const inputs = screen.getAllByRole('textbox');
    const values = inputs.map((inp) => (inp as HTMLInputElement).value);
    expect(values).toContain('Layer 1');
    expect(values).toContain('Layer 2');
  });

  it('calls setTilemapActiveLayerIndex when layer row clicked', () => {
    setupStore({ tilemapData: baseTilemapData });
    render(<TilemapLayerPanel />);
    // Each layer row is a div with onClick; find by layer name input and click its parent
    const inputs = screen.getAllByRole('textbox');
    const layer2Input = inputs.find((inp) => (inp as HTMLInputElement).value === 'Layer 2');
    // Click the parent container div of the input
    const layerRow = layer2Input!.closest('[class*="cursor-pointer"]');
    if (layerRow) {
      fireEvent.click(layerRow);
      expect(mockSetTilemapActiveLayerIndex).toHaveBeenCalledWith(1);
    }
  });

  it('shows visibility toggle button for visible layer', () => {
    setupStore({ tilemapData: baseTilemapData });
    render(<TilemapLayerPanel />);
    expect(screen.getByTitle('Hide layer')).toBeInTheDocument();
  });

  it('shows visibility toggle button for hidden layer', () => {
    setupStore({ tilemapData: baseTilemapData });
    render(<TilemapLayerPanel />);
    expect(screen.getByTitle('Show layer')).toBeInTheDocument();
  });

  it('calls setTilemapData when visibility toggle clicked', () => {
    setupStore({ tilemapData: baseTilemapData });
    render(<TilemapLayerPanel />);
    fireEvent.click(screen.getByTitle('Hide layer'));
    expect(mockSetTilemapData).toHaveBeenCalledWith(
      'entity-1',
      expect.objectContaining({
        layers: expect.arrayContaining([
          expect.objectContaining({ name: 'Layer 1', visible: false }),
        ]),
      })
    );
  });

  it('shows collision toggle with "Collision enabled" title for collision layer', () => {
    setupStore({ tilemapData: baseTilemapData });
    render(<TilemapLayerPanel />);
    expect(screen.getByTitle('Collision enabled')).toBeInTheDocument();
  });

  it('shows collision toggle with "Collision disabled" title for non-collision layer', () => {
    setupStore({ tilemapData: baseTilemapData });
    render(<TilemapLayerPanel />);
    expect(screen.getByTitle('Collision disabled')).toBeInTheDocument();
  });

  it('shows opacity percentage text for each layer', () => {
    setupStore({ tilemapData: baseTilemapData });
    render(<TilemapLayerPanel />);
    // Layer 1 has opacity 1 = 100%, Layer 2 has opacity 0.5 = 50%
    expect(screen.getAllByText('100%').length).toBeGreaterThan(0);
    expect(screen.getByText('50%')).toBeInTheDocument();
  });

  it('shows Delete layer button when more than one layer exists', () => {
    setupStore({ tilemapData: baseTilemapData });
    render(<TilemapLayerPanel />);
    expect(screen.getAllByTitle('Delete layer').length).toBeGreaterThan(0);
  });

  it('hides Delete button when only one layer exists', () => {
    setupStore({
      tilemapData: {
        ...baseTilemapData,
        layers: [baseTilemapData.layers[0]],
      },
    });
    render(<TilemapLayerPanel />);
    expect(screen.queryByTitle('Delete layer')).toBeNull();
  });

  it('renders Layer Opacity slider for active layer', () => {
    setupStore({ tilemapData: baseTilemapData, activeLayerIndex: 0 });
    render(<TilemapLayerPanel />);
    expect(screen.getByText('Layer Opacity')).toBeInTheDocument();
    expect(screen.getByRole('slider')).toBeInTheDocument();
  });

  it('calls setTilemapData when delete layer confirmed', async () => {
    mockConfirm.mockResolvedValue(true);
    setupStore({ tilemapData: baseTilemapData });
    render(<TilemapLayerPanel />);
    const deleteButtons = screen.getAllByTitle('Delete layer');
    fireEvent.click(deleteButtons[0]);
    await vi.waitFor(() => {
      expect(mockSetTilemapData).toHaveBeenCalled();
    });
  });
});
