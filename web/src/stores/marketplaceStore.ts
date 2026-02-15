import { create } from 'zustand';

export interface MarketplaceAssetView {
  id: string;
  name: string;
  description: string;
  category: string;
  priceTokens: number;
  license: string;
  previewUrl: string | null;
  sellerName: string;
  sellerId: string;
  downloadCount: number;
  avgRating: number;
  ratingCount: number;
  tags: string[];
  aiGenerated: boolean;
  createdAt: string;
}

interface MarketplaceState {
  assets: MarketplaceAssetView[];
  loading: boolean;
  error: string | null;

  // Filters
  searchQuery: string;
  category: string | null;
  sortBy: 'newest' | 'popular' | 'top_rated' | 'price_low' | 'price_high' | 'free';
  priceFilter: 'all' | 'free' | 'paid';
  page: number;
  hasMore: boolean;

  // User's assets
  purchasedAssetIds: Set<string>;
  sellerProfile: {
    displayName: string;
    bio: string;
    totalEarnings: number;
    totalSales: number;
  } | null;

  // Actions
  fetchAssets: (reset?: boolean) => Promise<void>;
  setSearchQuery: (q: string) => void;
  setCategory: (cat: string | null) => void;
  setSortBy: (sort: MarketplaceState['sortBy']) => void;
  setPriceFilter: (filter: MarketplaceState['priceFilter']) => void;
  purchaseAsset: (assetId: string) => Promise<void>;
  reviewAsset: (assetId: string, rating: number, content: string) => Promise<void>;
  fetchPurchased: () => Promise<void>;
  fetchSellerProfile: () => Promise<void>;
}

export const useMarketplaceStore = create<MarketplaceState>()((set, get) => ({
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

  fetchAssets: async (reset = false) => {
    const { searchQuery, category, sortBy, priceFilter, page } = get();
    const nextPage = reset ? 1 : page;

    set({ loading: true, error: null });

    try {
      const params = new URLSearchParams();
      if (searchQuery) params.set('q', searchQuery);
      if (category) params.set('category', category);
      params.set('sort', sortBy);
      params.set('price', priceFilter);
      params.set('page', nextPage.toString());
      params.set('limit', '20');

      const res = await fetch(`/api/marketplace/assets?${params}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed to fetch assets' }));
        throw new Error(err.error || 'Failed to fetch assets');
      }

      const data = await res.json();

      set({
        assets: reset ? data.assets : [...get().assets, ...data.assets],
        hasMore: data.hasMore,
        page: nextPage,
        loading: false,
      });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Unknown error', loading: false });
    }
  },

  setSearchQuery: (q) => {
    set({ searchQuery: q, page: 1 });
    get().fetchAssets(true);
  },

  setCategory: (cat) => {
    set({ category: cat, page: 1 });
    get().fetchAssets(true);
  },

  setSortBy: (sort) => {
    set({ sortBy: sort, page: 1 });
    get().fetchAssets(true);
  },

  setPriceFilter: (filter) => {
    set({ priceFilter: filter, page: 1 });
    get().fetchAssets(true);
  },

  purchaseAsset: async (assetId: string) => {
    set({ loading: true, error: null });

    try {
      const res = await fetch(`/api/marketplace/assets/${assetId}/purchase`, {
        method: 'POST',
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Purchase failed' }));
        throw new Error(err.error || 'Purchase failed');
      }

      set((state) => ({
        purchasedAssetIds: new Set([...state.purchasedAssetIds, assetId]),
        loading: false,
      }));
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Unknown error', loading: false });
      throw error;
    }
  },

  reviewAsset: async (assetId: string, rating: number, content: string) => {
    set({ loading: true, error: null });

    try {
      const res = await fetch(`/api/marketplace/assets/${assetId}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating, content }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Review failed' }));
        throw new Error(err.error || 'Review failed');
      }

      set({ loading: false });
      await get().fetchAssets(true);
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Unknown error', loading: false });
      throw error;
    }
  },

  fetchPurchased: async () => {
    try {
      const res = await fetch('/api/marketplace/purchases');
      if (!res.ok) return;

      const data = await res.json();
      set({ purchasedAssetIds: new Set(data.assetIds || []) });
    } catch {
      // Silent fail for purchased list
    }
  },

  fetchSellerProfile: async () => {
    try {
      const res = await fetch('/api/marketplace/seller');
      if (!res.ok) return;

      const data = await res.json();
      set({ sellerProfile: data.profile || null });
    } catch {
      // Silent fail
    }
  },
}));
