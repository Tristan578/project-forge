/**
 * Render tests for SpriteInspector component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { SpriteInspector } from '../SpriteInspector';
import { useEditorStore } from '@/stores/editorStore';
import type { SpriteData } from '@/stores/slices/types';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(() => ({})),
}));

vi.mock('../PixelArtEditor', () => ({
  PixelArtEditor: () => null,
}));

vi.mock('lucide-react', () => ({
  X: (props: Record<string, unknown>) => <span data-testid="x-icon" {...props} />,
  Image: (props: Record<string, unknown>) => <span data-testid="image-icon" {...props} />,
  Pencil: (props: Record<string, unknown>) => <span data-testid="pencil-icon" {...props} />,
}));

const defaultSortingLayers = [
  { name: 'Background', order: 0, visible: true },
  { name: 'Default', order: 1, visible: true },
  { name: 'Foreground', order: 2, visible: true },
];

const baseSpriteData: SpriteData = {
  textureAssetId: null,
  colorTint: [1, 1, 1, 1],
  flipX: false,
  flipY: false,
  customSize: null,
  sortingLayer: 'Default',
  sortingOrder: 0,
  anchor: 'center',
};

describe('SpriteInspector', () => {
  const mockSetSpriteData = vi.fn();
  const mockLoadTexture = vi.fn();

  function setupStore({
    primaryId = 'entity-1' as string | null,
    spriteData = baseSpriteData as SpriteData | null,
    sortingLayers = defaultSortingLayers,
    assetRegistry = {} as Record<string, { id: string; name: string; kind: string }>,
  } = {}) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useEditorStore).mockImplementation((selector: any) => {
      const sprites: Record<string, SpriteData> = {};
      if (primaryId && spriteData) {
        sprites[primaryId] = spriteData;
      }
      const state = {
        primaryId,
        sprites,
        sortingLayers,
        assetRegistry,
        setSpriteData: mockSetSpriteData,
        loadTexture: mockLoadTexture,
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

  it('returns null when no primaryId', () => {
    setupStore({ primaryId: null });
    const { container } = render(<SpriteInspector />);
    expect(container.firstChild).toBeNull();
  });

  it('returns null when no spriteData', () => {
    setupStore({ spriteData: null });
    const { container } = render(<SpriteInspector />);
    expect(container.firstChild).toBeNull();
  });

  it('renders Sprite heading', () => {
    setupStore();
    render(<SpriteInspector />);
    expect(screen.getByText('Sprite')).toBeDefined();
  });

  it('renders Texture label', () => {
    setupStore();
    render(<SpriteInspector />);
    expect(screen.getByText('Texture')).toBeDefined();
  });

  it('shows Upload Texture button when no assets available', () => {
    setupStore();
    render(<SpriteInspector />);
    expect(screen.getByText('Upload Texture')).toBeDefined();
  });

  it('shows texture select dropdown when assets available', () => {
    setupStore({
      assetRegistry: {
        'asset-1': { id: 'asset-1', name: 'player.png', kind: 'texture' },
      },
    });
    render(<SpriteInspector />);
    const selects = screen.getAllByRole('combobox');
    expect(selects.length).toBeGreaterThan(0);
    expect(screen.getByText('player.png')).toBeDefined();
  });

  it('renders Draw Pixel Art button', () => {
    setupStore();
    render(<SpriteInspector />);
    expect(screen.getByText('Draw Pixel Art')).toBeDefined();
  });

  it('renders Appearance section', () => {
    setupStore();
    render(<SpriteInspector />);
    expect(screen.getByText('Appearance')).toBeDefined();
  });

  it('renders Color Tint label', () => {
    setupStore();
    render(<SpriteInspector />);
    expect(screen.getByText('Color Tint')).toBeDefined();
  });

  it('renders Flip X and Flip Y checkboxes', () => {
    setupStore();
    render(<SpriteInspector />);
    expect(screen.getByText('Flip X')).toBeDefined();
    expect(screen.getByText('Flip Y')).toBeDefined();
  });

  it('flip X checkbox reflects state', () => {
    setupStore({ spriteData: { ...baseSpriteData, flipX: true } });
    render(<SpriteInspector />);
    const checkboxes = screen.getAllByRole('checkbox');
    // find Flip X checkbox (first flip checkbox)
    const flipXCheckbox = checkboxes.find(
      (cb) => (cb as HTMLInputElement).checked
    ) as HTMLInputElement;
    expect(flipXCheckbox?.checked).toBe(true);
  });

  it('calls setSpriteData when Flip Y toggled', () => {
    setupStore();
    render(<SpriteInspector />);
    // Find Flip Y checkbox by surrounding label text
    const flipYLabel = screen.getByText('Flip Y').closest('label');
    const flipYCheckbox = flipYLabel?.querySelector('input[type="checkbox"]') as HTMLInputElement;
    fireEvent.click(flipYCheckbox);
    expect(mockSetSpriteData).toHaveBeenCalledWith(
      'entity-1',
      expect.objectContaining({ flipY: true })
    );
  });

  it('renders Custom Size checkbox', () => {
    setupStore();
    render(<SpriteInspector />);
    expect(screen.getByText('Custom Size')).toBeDefined();
  });

  it('does not show Width/Height inputs when customSize is null', () => {
    setupStore();
    render(<SpriteInspector />);
    expect(screen.queryByText('Width')).toBeNull();
    expect(screen.queryByText('Height')).toBeNull();
  });

  it('shows Width and Height inputs when customSize is set', () => {
    setupStore({
      spriteData: { ...baseSpriteData, customSize: [2, 3] as [number, number] },
    });
    render(<SpriteInspector />);
    expect(screen.getByText('Width')).toBeDefined();
    expect(screen.getByText('Height')).toBeDefined();
  });

  it('renders Sorting section', () => {
    setupStore();
    render(<SpriteInspector />);
    expect(screen.getByText('Sorting')).toBeDefined();
  });

  it('renders Layer select with sorting layers', () => {
    setupStore();
    render(<SpriteInspector />);
    expect(screen.getByText('Background')).toBeDefined();
    expect(screen.getByText('Default')).toBeDefined();
    expect(screen.getByText('Foreground')).toBeDefined();
  });

  it('calls setSpriteData when layer changed', () => {
    setupStore();
    render(<SpriteInspector />);
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[0], { target: { value: 'Background' } });
    expect(mockSetSpriteData).toHaveBeenCalledWith(
      'entity-1',
      expect.objectContaining({ sortingLayer: 'Background' })
    );
  });

  it('renders Anchor section', () => {
    setupStore();
    render(<SpriteInspector />);
    expect(screen.getByText('Anchor')).toBeDefined();
  });

  it('renders 9 anchor buttons', () => {
    setupStore();
    render(<SpriteInspector />);
    // Each anchor button has a title attribute matching anchor name
    const anchorButtons = ['top_left', 'top_center', 'top_right',
      'middle_left', 'center', 'middle_right',
      'bottom_left', 'bottom_center', 'bottom_right'];
    for (const anchor of anchorButtons) {
      expect(screen.getByTitle(anchor)).toBeDefined();
    }
  });

  it('calls setSpriteData with new anchor when anchor button clicked', () => {
    setupStore();
    render(<SpriteInspector />);
    fireEvent.click(screen.getByTitle('top_left'));
    expect(mockSetSpriteData).toHaveBeenCalledWith(
      'entity-1',
      expect.objectContaining({ anchor: 'top_left' })
    );
  });
});
