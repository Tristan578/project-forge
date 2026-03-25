/**
 * Render tests for MaterialLibraryPanel component.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { MaterialLibraryPanel } from '../MaterialLibraryPanel';
import { useEditorStore } from '@/stores/editorStore';

vi.mock('@/stores/editorStore', () => ({
  useEditorStore: vi.fn(() => ({})),
}));

vi.mock('lucide-react', () => ({
  Search: (props: Record<string, unknown>) => <span data-testid="search-icon" {...props} />,
  Trash2: (props: Record<string, unknown>) => <span data-testid="trash-icon" {...props} />,
  Bookmark: (props: Record<string, unknown>) => <span data-testid="bookmark-icon" {...props} />,
}));

vi.mock('@/lib/materialPresets', () => ({
  MATERIAL_PRESETS: [
    {
      id: 'iron',
      name: 'Iron',
      description: 'Rough iron metal',
      category: 'metal',
      tags: ['metal', 'rough'],
      data: { baseColor: [0.5, 0.5, 0.5, 1], metallic: 1.0, perceptualRoughness: 0.7 },
    },
    {
      id: 'oak',
      name: 'Oak Wood',
      description: 'Natural oak wood',
      category: 'wood',
      tags: ['wood', 'natural'],
      data: { baseColor: [0.6, 0.4, 0.2, 1], metallic: 0.0, perceptualRoughness: 0.9 },
    },
  ],
  ALL_CATEGORIES: ['basic', 'metal', 'natural', 'glass', 'special', 'fabric', 'plastic', 'stone', 'wood'] as const,
  loadCustomMaterials: vi.fn(() => []),
  deleteCustomMaterial: vi.fn(),
}));

describe('MaterialLibraryPanel', () => {
  const mockUpdateMaterial = vi.fn();

  function setupStore({ primaryId = 'entity-1' as string | null } = {}) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useEditorStore).mockImplementation((selector: any) => {
      const state = {
        primaryId,
        updateMaterial: mockUpdateMaterial,
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

  it('renders search input', () => {
    setupStore();
    render(<MaterialLibraryPanel />);
    expect(screen.getByPlaceholderText('Search materials...')).not.toBeNull();
  });

  it('renders category filter pills', () => {
    setupStore();
    render(<MaterialLibraryPanel />);
    expect(screen.getByText('metal')).not.toBeNull();
    expect(screen.getByText('wood')).not.toBeNull();
    expect(screen.getByText('basic')).not.toBeNull();
  });

  it('renders material preset names', () => {
    setupStore();
    render(<MaterialLibraryPanel />);
    expect(screen.getByText('Iron')).not.toBeNull();
    expect(screen.getByText('Oak Wood')).not.toBeNull();
  });

  it('shows "Select an entity" message when no primaryId', () => {
    setupStore({ primaryId: null });
    render(<MaterialLibraryPanel />);
    expect(screen.getByText('Select an entity to apply materials')).not.toBeNull();
  });

  it('does not show "Select an entity" message when entity selected', () => {
    setupStore();
    render(<MaterialLibraryPanel />);
    expect(screen.queryByText('Select an entity to apply materials')).toBeNull();
  });

  it('filters materials when search term entered', () => {
    setupStore();
    render(<MaterialLibraryPanel />);
    const searchInput = screen.getByPlaceholderText('Search materials...');
    fireEvent.change(searchInput, { target: { value: 'iron' } });
    expect(screen.getByText('Iron')).not.toBeNull();
    expect(screen.queryByText('Oak Wood')).toBeNull();
  });

  it('shows "No materials found" when search matches nothing', () => {
    setupStore();
    render(<MaterialLibraryPanel />);
    const searchInput = screen.getByPlaceholderText('Search materials...');
    fireEvent.change(searchInput, { target: { value: 'xyznotfound' } });
    expect(screen.getByText('No materials found')).not.toBeNull();
  });

  it('calls updateMaterial when material card clicked', () => {
    setupStore();
    render(<MaterialLibraryPanel />);
    // Click on a material card by clicking its title element
    const ironCard = screen.getByTitle(/Iron — /);
    fireEvent.click(ironCard);
    expect(mockUpdateMaterial).toHaveBeenCalledWith(
      'entity-1',
      expect.objectContaining({ metallic: 1.0 })
    );
  });

  it('toggles category filter when category pill clicked', () => {
    setupStore();
    render(<MaterialLibraryPanel />);
    // Click metal category to filter — should hide oak wood (wood category)
    const metalButton = screen.getByText('metal').closest('button')!;
    fireEvent.click(metalButton);
    expect(screen.getByText('Iron')).not.toBeNull();
    // Oak Wood is in 'wood' category — should be hidden
    expect(screen.queryByText('Oak Wood')).toBeNull();
  });
});
