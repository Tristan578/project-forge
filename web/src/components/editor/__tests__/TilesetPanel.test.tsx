/**
 * Render tests for TilesetPanel component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { TilesetPanel } from '../TilesetPanel';
import { useEditorStore } from '@/stores/editorStore';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(() => ({})),
}));

vi.mock('lucide-react', () => ({
  Upload: (props: Record<string, unknown>) => <span data-testid="upload-icon" {...props} />,
}));

const fakeTileset = {
  assetId: 'data:image/png;base64,abc',
  name: 'dungeon',
  tileSize: [32, 32] as [number, number],
  gridSize: [4, 4] as [number, number],
  spacing: 0,
  margin: 0,
  tiles: [],
};

describe('TilesetPanel', () => {
  const mockSetTileset = vi.fn();
  const mockSetActiveTileset = vi.fn();

  function setupStore({
    tilesets = {} as Record<string, typeof fakeTileset>,
    activeTilesetId = null as string | null,
  } = {}) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useEditorStore).mockImplementation((selector: any) => {
      const state = {
        tilesets,
        activeTilesetId,
        setActiveTileset: mockSetActiveTileset,
        setTileset: mockSetTileset,
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

  it('shows "No tilesets imported yet" when empty', () => {
    setupStore();
    render(<TilesetPanel />);
    expect(screen.getByText('No tilesets imported yet')).not.toBeNull();
  });

  it('shows Import Tileset button when empty', () => {
    setupStore();
    render(<TilesetPanel />);
    expect(screen.getByText('Import Tileset')).not.toBeNull();
  });

  it('renders Tileset heading when tilesets exist', () => {
    setupStore({ tilesets: { 'ts-1': fakeTileset }, activeTilesetId: 'ts-1' });
    render(<TilesetPanel />);
    expect(screen.getByText('Tileset')).not.toBeNull();
  });

  it('shows tileset name in select option', () => {
    setupStore({ tilesets: { 'ts-1': fakeTileset }, activeTilesetId: 'ts-1' });
    render(<TilesetPanel />);
    expect(screen.getByRole('option', { name: 'dungeon' })).not.toBeNull();
  });

  it('shows "Select tileset..." placeholder option', () => {
    setupStore({ tilesets: { 'ts-1': fakeTileset }, activeTilesetId: null });
    render(<TilesetPanel />);
    expect(screen.getByRole('option', { name: 'Select tileset...' })).not.toBeNull();
  });

  it('calls setActiveTileset when select changes', () => {
    setupStore({ tilesets: { 'ts-1': fakeTileset }, activeTilesetId: null });
    render(<TilesetPanel />);
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: 'ts-1' } });
    expect(mockSetActiveTileset).toHaveBeenCalledWith('ts-1');
  });

  it('renders Import Tileset title button when tilesets exist', () => {
    setupStore({ tilesets: { 'ts-1': fakeTileset }, activeTilesetId: 'ts-1' });
    render(<TilesetPanel />);
    expect(screen.getByTitle('Import Tileset')).not.toBeNull();
  });

  it('renders tile grid cells when active tileset is selected', () => {
    setupStore({ tilesets: { 'ts-1': fakeTileset }, activeTilesetId: 'ts-1' });
    render(<TilesetPanel />);
    // 4x4 grid = 16 tiles, each with title "Tile N"
    expect(screen.getByTitle('Tile 0')).not.toBeNull();
    expect(screen.getByTitle('Tile 15')).not.toBeNull();
  });

  it('does not render tile grid when no active tileset', () => {
    setupStore({ tilesets: { 'ts-1': fakeTileset }, activeTilesetId: null });
    render(<TilesetPanel />);
    expect(screen.queryByTitle('Tile 0')).toBeNull();
  });
});
