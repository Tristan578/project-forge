/**
 * Tests for MarketplacePage — category filtering, search input, sort/price
 * filter controls, asset grid rendering, loading/error/empty states,
 * and load-more button.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@/test/utils/componentTestUtils';
import { MarketplacePage } from '../MarketplacePage';
import { useMarketplaceStore } from '@/stores/marketplaceStore';

vi.mock('@/stores/marketplaceStore', () => ({
  useMarketplaceStore: vi.fn(() => ({})),
}));

vi.mock('../AssetCard', () => ({
  AssetCard: ({ asset }: { asset: { id: string; name: string } }) => (
    <div data-testid={`asset-card-${asset.id}`}>{asset.name}</div>
  ),
}));

const mockFetchAssets = vi.fn();
const mockFetchPurchased = vi.fn();
const mockSetSearchQuery = vi.fn();
const mockSetCategory = vi.fn();
const mockSetSortBy = vi.fn();
const mockSetPriceFilter = vi.fn();

function makeAsset(id: string, name = `Asset ${id}`) {
  return {
    id,
    name,
    description: '',
    category: 'model_3d',
    priceTokens: 0,
    license: 'free',
    previewUrl: null,
    sellerName: 'Seller',
    sellerId: 'seller-1',
    downloadCount: 0,
    avgRating: 0,
    ratingCount: 0,
    tags: [],
    aiGenerated: false,
    createdAt: new Date().toISOString(),
  };
}

function setupStore(overrides: {
  assets?: ReturnType<typeof makeAsset>[];
  loading?: boolean;
  error?: string | null;
  searchQuery?: string;
  category?: string | null;
  sortBy?: string;
  priceFilter?: string;
  hasMore?: boolean;
} = {}) {
  const state = {
    assets: overrides.assets ?? [],
    loading: overrides.loading ?? false,
    error: overrides.error ?? null,
    searchQuery: overrides.searchQuery ?? '',
    category: overrides.category ?? null,
    sortBy: overrides.sortBy ?? 'popular',
    priceFilter: overrides.priceFilter ?? 'all',
    hasMore: overrides.hasMore ?? false,
    fetchAssets: mockFetchAssets,
    fetchPurchased: mockFetchPurchased,
    setSearchQuery: mockSetSearchQuery,
    setCategory: mockSetCategory,
    setSortBy: mockSetSortBy,
    setPriceFilter: mockSetPriceFilter,
  };
  // MarketplacePage uses useMarketplaceStore() without a selector
  vi.mocked(useMarketplaceStore).mockReturnValue(state as ReturnType<typeof useMarketplaceStore>);
}

describe('MarketplacePage', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  // ── Mount & init ───────────────────────────────────────────────────────

  it('calls fetchAssets and fetchPurchased on mount', () => {
    setupStore();
    render(<MarketplacePage />);
    expect(mockFetchAssets).toHaveBeenCalledWith(true);
    expect(mockFetchPurchased).toHaveBeenCalled();
  });

  // ── Category sidebar ───────────────────────────────────────────────────

  it('renders All Assets and category buttons', () => {
    setupStore();
    render(<MarketplacePage />);
    expect(screen.getByText('All Assets')).not.toBeNull();
    expect(screen.getByText('3D Models')).not.toBeNull();
    expect(screen.getByText('Sprites')).not.toBeNull();
    expect(screen.getByText('Audio')).not.toBeNull();
  });

  it('calls setCategory(null) when "All Assets" is clicked', () => {
    setupStore({ category: 'model_3d' });
    render(<MarketplacePage />);
    fireEvent.click(screen.getByText('All Assets'));
    expect(mockSetCategory).toHaveBeenCalledWith(null);
  });

  it('calls setCategory with correct id when a category is clicked', () => {
    setupStore();
    render(<MarketplacePage />);
    fireEvent.click(screen.getByText('3D Models'));
    expect(mockSetCategory).toHaveBeenCalledWith('model_3d');
  });

  // ── Search input ───────────────────────────────────────────────────────

  it('renders search input', () => {
    setupStore();
    render(<MarketplacePage />);
    expect(screen.getByPlaceholderText('Search assets...')).not.toBeNull();
  });

  it('calls setSearchQuery on input change', () => {
    setupStore();
    render(<MarketplacePage />);
    const input = screen.getByPlaceholderText('Search assets...');
    fireEvent.change(input, { target: { value: 'sword' } });
    expect(mockSetSearchQuery).toHaveBeenCalledWith('sword');
  });

  it('shows the current search query value', () => {
    setupStore({ searchQuery: 'dragon' });
    render(<MarketplacePage />);
    const input = screen.getByPlaceholderText('Search assets...') as HTMLInputElement;
    expect(input.value).toBe('dragon');
  });

  // ── Sort selector ──────────────────────────────────────────────────────

  it('renders sort selector with default value', () => {
    setupStore({ sortBy: 'popular' });
    render(<MarketplacePage />);
    const sortSelect = screen.getByDisplayValue('Most Popular');
    expect(sortSelect).not.toBeNull();
  });

  it('calls setSortBy when sort option is changed', () => {
    setupStore();
    render(<MarketplacePage />);
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[0], { target: { value: 'newest' } });
    expect(mockSetSortBy).toHaveBeenCalledWith('newest');
  });

  // ── Price filter ───────────────────────────────────────────────────────

  it('renders price filter selector', () => {
    setupStore();
    render(<MarketplacePage />);
    expect(screen.getByDisplayValue('All Prices')).not.toBeNull();
  });

  it('calls setPriceFilter when price option is changed', () => {
    setupStore();
    render(<MarketplacePage />);
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[1], { target: { value: 'free' } });
    expect(mockSetPriceFilter).toHaveBeenCalledWith('free');
  });

  // ── Asset grid ─────────────────────────────────────────────────────────

  it('renders asset cards for each asset', () => {
    setupStore({ assets: [makeAsset('a1', 'Sword'), makeAsset('a2', 'Shield')] });
    render(<MarketplacePage />);
    expect(screen.getByTestId('asset-card-a1')).not.toBeNull();
    expect(screen.getByTestId('asset-card-a2')).not.toBeNull();
    expect(screen.getByText('Sword')).not.toBeNull();
    expect(screen.getByText('Shield')).not.toBeNull();
  });

  // ── Empty state ────────────────────────────────────────────────────────

  it('shows empty state message when no assets and not loading', () => {
    setupStore({ assets: [], loading: false });
    render(<MarketplacePage />);
    expect(screen.getByText(/no assets found/i)).not.toBeNull();
  });

  // ── Loading state ──────────────────────────────────────────────────────

  it('shows loading message when loading with no assets', () => {
    setupStore({ assets: [], loading: true });
    render(<MarketplacePage />);
    expect(screen.getByText('Loading...')).not.toBeNull();
  });

  // ── Error state ────────────────────────────────────────────────────────

  it('shows error message when error is set', () => {
    setupStore({ error: 'Failed to fetch assets', assets: [] });
    render(<MarketplacePage />);
    expect(screen.getByText('Failed to fetch assets')).not.toBeNull();
  });

  // ── Load more ──────────────────────────────────────────────────────────

  it('shows Load More button when hasMore is true and assets exist', () => {
    setupStore({ assets: [makeAsset('a1')], hasMore: true });
    render(<MarketplacePage />);
    expect(screen.getByText('Load More')).not.toBeNull();
  });

  it('calls fetchAssets(false) when Load More is clicked', () => {
    setupStore({ assets: [makeAsset('a1')], hasMore: true, loading: false });
    render(<MarketplacePage />);
    fireEvent.click(screen.getByText('Load More'));
    expect(mockFetchAssets).toHaveBeenCalledWith(false);
  });

  it('does not show Load More when hasMore is false', () => {
    setupStore({ assets: [makeAsset('a1')], hasMore: false });
    render(<MarketplacePage />);
    expect(screen.queryByText('Load More')).toBeNull();
  });

  it('Load More button shows loading text when loading', () => {
    setupStore({ assets: [makeAsset('a1')], hasMore: true, loading: true });
    render(<MarketplacePage />);
    expect(screen.getByText('Loading...')).not.toBeNull();
  });
});
