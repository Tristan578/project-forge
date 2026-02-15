'use client';

import React, { useState } from 'react';
import { MarketplaceAssetView } from '@/stores/marketplaceStore';
import { Star, Download, Sparkles } from 'lucide-react';
import { AssetDetailModal } from './AssetDetailModal';

interface AssetCardProps {
  asset: MarketplaceAssetView;
}

const CATEGORY_COLORS: Record<string, string> = {
  model_3d: 'bg-blue-600',
  sprite: 'bg-purple-600',
  texture: 'bg-green-600',
  audio: 'bg-pink-600',
  script: 'bg-yellow-600',
  prefab: 'bg-orange-600',
  template: 'bg-red-600',
  shader: 'bg-cyan-600',
  animation: 'bg-indigo-600',
};

export function AssetCard({ asset }: AssetCardProps) {
  const [showDetail, setShowDetail] = useState(false);

  const categoryColor = CATEGORY_COLORS[asset.category] || 'bg-zinc-600';

  return (
    <>
      <button
        onClick={() => setShowDetail(true)}
        className="group bg-zinc-800 border border-zinc-700 rounded-lg overflow-hidden hover:border-blue-500 transition-all text-left"
      >
        {/* Preview */}
        <div className="aspect-square bg-zinc-900 relative overflow-hidden">
          {asset.previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={asset.previewUrl}
              alt={asset.name}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-zinc-600">
              <div className="text-center">
                <div className={`${categoryColor} w-16 h-16 rounded-full mx-auto mb-2 flex items-center justify-center`}>
                  <span className="text-2xl font-bold text-white">
                    {asset.category.charAt(0).toUpperCase()}
                  </span>
                </div>
                <div className="text-xs">{asset.category.replace('_', ' ')}</div>
              </div>
            </div>
          )}

          {/* Badges */}
          <div className="absolute top-2 left-2 flex flex-wrap gap-1">
            <span className={`${categoryColor} text-white text-xs px-2 py-1 rounded`}>
              {asset.category.replace('_', ' ')}
            </span>
            {asset.aiGenerated && (
              <span className="bg-purple-600 text-white text-xs px-2 py-1 rounded flex items-center gap-1">
                <Sparkles className="w-3 h-3" />
                AI
              </span>
            )}
          </div>

          {/* Price Badge */}
          <div className="absolute top-2 right-2">
            <span className="bg-black/80 text-white text-xs px-2 py-1 rounded font-semibold">
              {asset.priceTokens === 0 ? 'Free' : `${asset.priceTokens} tokens`}
            </span>
          </div>
        </div>

        {/* Info */}
        <div className="p-3">
          <h3 className="text-sm font-semibold text-zinc-200 truncate group-hover:text-blue-400 transition-colors">
            {asset.name}
          </h3>
          <p className="text-xs text-zinc-500 mt-1">by {asset.sellerName}</p>

          <div className="flex items-center justify-between mt-2">
            <div className="flex items-center gap-1 text-xs text-zinc-400">
              <Star className="w-3 h-3 fill-yellow-500 text-yellow-500" />
              <span>{asset.avgRating.toFixed(1)}</span>
              <span className="text-zinc-600">({asset.ratingCount})</span>
            </div>

            <div className="flex items-center gap-1 text-xs text-zinc-400">
              <Download className="w-3 h-3" />
              <span>{asset.downloadCount}</span>
            </div>
          </div>
        </div>
      </button>

      {showDetail && <AssetDetailModal assetId={asset.id} onClose={() => setShowDetail(false)} />}
    </>
  );
}
