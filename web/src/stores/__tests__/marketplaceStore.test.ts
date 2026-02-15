/**
 * Unit tests for the marketplaceStore Zustand store.
 *
 * Tests cover asset marketplace, filters, sorting, pagination, purchases,
 * reviews, and seller profile management.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useMarketplaceStore, type MarketplaceAssetView } from '../marketplaceStore';

// Mock fetch globally
global.fetch = vi.fn();

const mockAsset: MarketplaceAssetView = {
  id: 'asset-1',
  name: 'Test Asset',
  description: 'A test asset',
  category: 'models',
  priceTokens: 100,
  license: 'CC0',
  previewUrl: 'https://example.com/preview.png',
  sellerName: 'Test Seller',
  sellerId: 'seller-1',
  downloadCount: 50,
  avgRating: 4.2,
  ratingCount: 10,
  tags: ['low-poly', '3d'],
  aiGenerated: false,
  createdAt: '2025-01-01T00:00:00Z',
};

describe('marketplaceStore', () => {
  beforeEach(() => {
    // Reset store to initial state
    useMarketplaceStore.setState({
      assets: [],
      loading: false,
      error: null,
      searchQuery: '',
      category: null,
      sortBy: 'popular',
      priceFilter: 'all',
      page: 1,
      hasMore: true,
      purchasedAssetIds: new Set(),
      sellerProfile: null,
    });
    // Clear mocks
    vi.clearAllMocks();
  });

  describe('Initial State', () => {
    it('should initialize with empty assets', () => {
      const state = useMarketplaceStore.getState();
      expect(state.assets).toEqual([]);
    });

    it('should initialize with popular sort', () => {
      const state = useMarketplaceStore.getState();
      expect(state.sortBy).toBe('popular');
    });

    it('should initialize with all price filter', () => {
      const state = useMarketplaceStore.getState();
      expect(state.priceFilter).toBe('all');
    });

    it('should initialize with no category filter', () => {
      const state = useMarketplaceStore.getState();
      expect(state.category).toBeNull();
    });

    it('should initialize with page 1', () => {
      const state = useMarketplaceStore.getState();
      expect(state.page).toBe(1);
      expect(state.hasMore).toBe(true);
    });

    it('should initialize with empty purchases', () => {
      const state = useMarketplaceStore.getState();
      expect(state.purchasedAssetIds).toEqual(new Set());
    });

    it('should initialize with no seller profile', () => {
      const state = useMarketplaceStore.getState();
      expect(state.sellerProfile).toBeNull();
    });
  });

  describe('Filter Actions', () => {
    it('should update search query and reset page', () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ assets: [], hasMore: false }),
      } as Response);

      const { setSearchQuery } = useMarketplaceStore.getState();
      setSearchQuery('character');

      const state = useMarketplaceStore.getState();
      expect(state.searchQuery).toBe('character');
      expect(state.page).toBe(1);
    });

    it('should update category and reset page', () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ assets: [], hasMore: false }),
      } as Response);

      const { setCategory } = useMarketplaceStore.getState();
      setCategory('textures');

      const state = useMarketplaceStore.getState();
      expect(state.category).toBe('textures');
      expect(state.page).toBe(1);
    });

    it('should clear category filter', () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ assets: [], hasMore: false }),
      } as Response);

      useMarketplaceStore.setState({ category: 'models' });
      const { setCategory } = useMarketplaceStore.getState();
      setCategory(null);

      const state = useMarketplaceStore.getState();
      expect(state.category).toBeNull();
    });

    it('should update sort by', () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ assets: [], hasMore: false }),
      } as Response);

      const { setSortBy } = useMarketplaceStore.getState();
      setSortBy('price_low');

      const state = useMarketplaceStore.getState();
      expect(state.sortBy).toBe('price_low');
    });

    it('should update price filter', () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ assets: [], hasMore: false }),
      } as Response);

      const { setPriceFilter } = useMarketplaceStore.getState();
      setPriceFilter('free');

      const state = useMarketplaceStore.getState();
      expect(state.priceFilter).toBe('free');
    });
  });

  describe('fetchAssets', () => {
    it('should fetch assets successfully', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ assets: [mockAsset], hasMore: true }),
      } as Response);

      const { fetchAssets } = useMarketplaceStore.getState();
      await fetchAssets();

      const state = useMarketplaceStore.getState();
      expect(state.assets).toHaveLength(1);
      expect(state.assets[0]).toEqual(mockAsset);
      expect(state.loading).toBe(false);
    });

    it('should append assets when not resetting', async () => {
      useMarketplaceStore.setState({ assets: [mockAsset], page: 2 });

      const newAsset = { ...mockAsset, id: 'asset-2', name: 'Asset 2' };
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ assets: [newAsset], hasMore: false }),
      } as Response);

      const { fetchAssets } = useMarketplaceStore.getState();
      await fetchAssets(false);

      const state = useMarketplaceStore.getState();
      expect(state.assets).toHaveLength(2);
      expect(state.hasMore).toBe(false);
    });

    it('should replace assets when resetting', async () => {
      useMarketplaceStore.setState({ assets: [mockAsset], page: 3 });

      const newAsset = { ...mockAsset, id: 'asset-2', name: 'Asset 2' };
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ assets: [newAsset], hasMore: true }),
      } as Response);

      const { fetchAssets } = useMarketplaceStore.getState();
      await fetchAssets(true);

      const state = useMarketplaceStore.getState();
      expect(state.assets).toHaveLength(1);
      expect(state.assets[0]).toEqual(newAsset);
      expect(state.page).toBe(1);
    });

    it('should handle fetch error', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        json: async () => ({ error: 'Network error' }),
      } as Response);

      const { fetchAssets } = useMarketplaceStore.getState();
      await fetchAssets();

      const state = useMarketplaceStore.getState();
      expect(state.error).toBe('Network error');
      expect(state.loading).toBe(false);
    });

    it('should build correct query params', async () => {
      useMarketplaceStore.setState({
        searchQuery: 'sword',
        category: 'models',
        sortBy: 'newest',
        priceFilter: 'paid',
      });

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ assets: [], hasMore: false }),
      } as Response);

      const { fetchAssets } = useMarketplaceStore.getState();
      await fetchAssets();

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('q=sword')
      );
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('category=models')
      );
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('sort=newest')
      );
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('price=paid')
      );
    });
  });

  describe('Asset Purchase', () => {
    it('should purchase asset successfully', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({}),
      } as Response);

      const { purchaseAsset } = useMarketplaceStore.getState();
      await purchaseAsset('asset-1');

      const state = useMarketplaceStore.getState();
      expect(state.purchasedAssetIds.has('asset-1')).toBe(true);
      expect(state.loading).toBe(false);
    });

    it('should handle purchase error', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        json: async () => ({ error: 'Insufficient tokens' }),
      } as Response);

      const { purchaseAsset } = useMarketplaceStore.getState();
      await expect(purchaseAsset('asset-1')).rejects.toThrow('Insufficient tokens');

      const state = useMarketplaceStore.getState();
      expect(state.error).toBe('Insufficient tokens');
    });
  });

  describe('Asset Review', () => {
    it('should submit review successfully', async () => {
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      } as Response).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ assets: [], hasMore: false }),
      } as Response);

      const { reviewAsset } = useMarketplaceStore.getState();
      await reviewAsset('asset-1', 5, 'Great asset!');

      expect(fetch).toHaveBeenCalledWith(
        '/api/marketplace/assets/asset-1/review',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ rating: 5, content: 'Great asset!' }),
        })
      );
    });

    it('should handle review error', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        json: async () => ({ error: 'Already reviewed' }),
      } as Response);

      const { reviewAsset } = useMarketplaceStore.getState();
      await expect(reviewAsset('asset-1', 4, 'Good')).rejects.toThrow('Already reviewed');
    });
  });

  describe('Purchased Assets', () => {
    it('should fetch purchased assets', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ assetIds: ['asset-1', 'asset-2'] }),
      } as Response);

      const { fetchPurchased } = useMarketplaceStore.getState();
      await fetchPurchased();

      const state = useMarketplaceStore.getState();
      expect(state.purchasedAssetIds.size).toBe(2);
      expect(state.purchasedAssetIds.has('asset-1')).toBe(true);
      expect(state.purchasedAssetIds.has('asset-2')).toBe(true);
    });

    it('should handle fetch error silently', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
      } as Response);

      const { fetchPurchased } = useMarketplaceStore.getState();
      await fetchPurchased();

      // Should not throw
      const state = useMarketplaceStore.getState();
      expect(state.purchasedAssetIds.size).toBe(0);
    });
  });

  describe('Seller Profile', () => {
    it('should fetch seller profile', async () => {
      const profile = {
        displayName: 'Test Seller',
        bio: 'I sell things',
        totalEarnings: 1000,
        totalSales: 50,
      };

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ profile }),
      } as Response);

      const { fetchSellerProfile } = useMarketplaceStore.getState();
      await fetchSellerProfile();

      const state = useMarketplaceStore.getState();
      expect(state.sellerProfile).toEqual(profile);
    });

    it('should handle fetch error silently', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
      } as Response);

      const { fetchSellerProfile } = useMarketplaceStore.getState();
      await fetchSellerProfile();

      const state = useMarketplaceStore.getState();
      expect(state.sellerProfile).toBeNull();
    });
  });
});
