'use client';

import React, { useEffect } from 'react';
import { useMarketplaceStore } from '@/stores/marketplaceStore';
import { AssetCard } from './AssetCard';
import {
  Search,
  Box,
  Image as ImageIcon,
  Paintbrush,
  Music,
  Code,
  Package,
  FileText,
  Sparkles,
  Film,
} from 'lucide-react';

const CATEGORIES = [
  { id: 'model_3d', label: '3D Models', icon: Box },
  { id: 'sprite', label: 'Sprites', icon: ImageIcon },
  { id: 'texture', label: 'Textures', icon: Paintbrush },
  { id: 'audio', label: 'Audio', icon: Music },
  { id: 'script', label: 'Scripts', icon: Code },
  { id: 'prefab', label: 'Prefabs', icon: Package },
  { id: 'template', label: 'Templates', icon: FileText },
  { id: 'shader', label: 'Shaders', icon: Sparkles },
  { id: 'animation', label: 'Animations', icon: Film },
];

export function MarketplacePage() {
  const {
    assets,
    loading,
    error,
    searchQuery,
    category,
    sortBy,
    priceFilter,
    hasMore,
    fetchAssets,
    setSearchQuery,
    setCategory,
    setSortBy,
    setPriceFilter,
    fetchPurchased,
  } = useMarketplaceStore();

  useEffect(() => {
    fetchAssets(true);
    fetchPurchased();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLoadMore = () => {
    if (!loading && hasMore) {
      fetchAssets(false);
    }
  };

  return (
    <div className="flex h-full bg-zinc-900">
      {/* Category Sidebar */}
      <div className="w-60 border-r border-zinc-800 p-4 overflow-y-auto">
        <h2 className="text-sm font-semibold text-zinc-300 mb-3">Categories</h2>
        <div className="space-y-1">
          <button
            onClick={() => setCategory(null)}
            className={`w-full flex items-center gap-2 px-3 py-2 rounded text-sm transition-colors ${
              category === null
                ? 'bg-blue-600 text-white'
                : 'text-zinc-300 hover:bg-zinc-800'
            }`}
          >
            <Package className="w-4 h-4" />
            All Assets
          </button>
          {CATEGORIES.map((cat) => {
            const Icon = cat.icon;
            return (
              <button
                key={cat.id}
                onClick={() => setCategory(cat.id)}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded text-sm transition-colors ${
                  category === cat.id
                    ? 'bg-blue-600 text-white'
                    : 'text-zinc-300 hover:bg-zinc-800'
                }`}
              >
                <Icon className="w-4 h-4" />
                {cat.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <div className="border-b border-zinc-800 p-4 space-y-3">
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
              <input
                type="text"
                placeholder="Search assets..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-2 bg-zinc-800 border border-zinc-700 rounded text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
              className="px-3 py-2 bg-zinc-800 border border-zinc-700 rounded text-sm text-zinc-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="popular">Most Popular</option>
              <option value="newest">Newest</option>
              <option value="top_rated">Top Rated</option>
              <option value="price_low">Price: Low to High</option>
              <option value="price_high">Price: High to Low</option>
              <option value="free">Free Only</option>
            </select>

            <select
              value={priceFilter}
              onChange={(e) => setPriceFilter(e.target.value as typeof priceFilter)}
              className="px-3 py-2 bg-zinc-800 border border-zinc-700 rounded text-sm text-zinc-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All Prices</option>
              <option value="free">Free</option>
              <option value="paid">Paid</option>
            </select>
          </div>
        </div>

        {/* Asset Grid */}
        <div className="flex-1 overflow-y-auto p-4">
          {error && (
            <div className="bg-red-900/20 border border-red-500 text-red-300 px-4 py-3 rounded mb-4">
              {error}
            </div>
          )}

          {assets.length === 0 && !loading && (
            <div className="text-center py-12 text-zinc-500">
              No assets found. Try adjusting your filters.
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {assets.map((asset) => (
              <AssetCard key={asset.id} asset={asset} />
            ))}
          </div>

          {loading && assets.length === 0 && (
            <div className="text-center py-12 text-zinc-500">Loading...</div>
          )}

          {hasMore && assets.length > 0 && (
            <div className="text-center mt-6">
              <button
                onClick={handleLoadMore}
                disabled={loading}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-700 disabled:text-zinc-500 text-white rounded transition-colors"
              >
                {loading ? 'Loading...' : 'Load More'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
