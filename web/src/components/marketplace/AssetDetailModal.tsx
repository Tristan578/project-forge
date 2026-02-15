'use client';

import React, { useEffect, useState } from 'react';
import { X, Star, Download, ExternalLink, Sparkles, ShoppingCart } from 'lucide-react';
import { useMarketplaceStore } from '@/stores/marketplaceStore';

interface AssetDetailModalProps {
  assetId: string;
  onClose: () => void;
}

interface AssetDetail {
  id: string;
  name: string;
  description: string;
  category: string;
  priceTokens: number;
  license: string;
  previewUrl: string | null;
  assetFileSize: number | null;
  downloadCount: number;
  avgRating: number;
  ratingCount: number;
  tags: string[];
  aiGenerated: boolean;
  aiProvider: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  seller: {
    id: string;
    name: string;
    bio: string | null;
    portfolioUrl: string | null;
  };
}

interface Review {
  id: string;
  rating: number;
  content: string | null;
  createdAt: string;
  userName: string;
}

export function AssetDetailModal({ assetId, onClose }: AssetDetailModalProps) {
  const [asset, setAsset] = useState<AssetDetail | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState(false);
  const [rating, setRating] = useState(0);
  const [reviewContent, setReviewContent] = useState('');
  const [submittingReview, setSubmittingReview] = useState(false);

  const { purchasedAssetIds, purchaseAsset, reviewAsset } = useMarketplaceStore();

  const isPurchased = purchasedAssetIds.has(assetId);

  useEffect(() => {
    const fetchDetail = async () => {
      try {
        const res = await fetch(`/api/marketplace/assets/${assetId}`);
        if (!res.ok) throw new Error('Failed to fetch');
        const data = await res.json();
        setAsset(data.asset);
        setReviews(data.reviews || []);
      } catch (error) {
        console.error('Error fetching asset:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchDetail();
  }, [assetId]);

  const handlePurchase = async () => {
    if (!asset) return;
    setPurchasing(true);

    try {
      await purchaseAsset(assetId);
      alert('Purchase successful! You can now download this asset.');
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Purchase failed');
    } finally {
      setPurchasing(false);
    }
  };

  const handleReview = async () => {
    if (rating === 0) return;
    setSubmittingReview(true);

    try {
      await reviewAsset(assetId, rating, reviewContent);
      alert('Review submitted successfully!');
      setRating(0);
      setReviewContent('');
      window.location.reload();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to submit review');
    } finally {
      setSubmittingReview(false);
    }
  };

  const handleDownload = () => {
    window.open(`/api/marketplace/assets/${assetId}/download`, '_blank');
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
        <div className="text-zinc-300">Loading...</div>
      </div>
    );
  }

  if (!asset) {
    return (
      <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
        <div className="text-zinc-300">Asset not found</div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-zinc-900 rounded-lg border border-zinc-700 w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-zinc-800">
          <h2 className="text-xl font-bold text-zinc-200">{asset.name}</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-zinc-800 rounded transition-colors"
          >
            <X className="w-5 h-5 text-zinc-400" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Preview */}
          {asset.previewUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={asset.previewUrl}
              alt={asset.name}
              className="w-full max-h-96 object-contain bg-zinc-800 rounded"
            />
          )}

          {/* Info Grid */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-sm text-zinc-500">Price</div>
              <div className="text-lg font-semibold text-zinc-200">
                {asset.priceTokens === 0 ? 'Free' : `${asset.priceTokens} tokens`}
              </div>
            </div>
            <div>
              <div className="text-sm text-zinc-500">License</div>
              <div className="text-lg font-semibold text-zinc-200 capitalize">
                {asset.license}
              </div>
            </div>
            <div>
              <div className="text-sm text-zinc-500">Rating</div>
              <div className="flex items-center gap-2">
                <Star className="w-4 h-4 fill-yellow-500 text-yellow-500" />
                <span className="text-lg font-semibold text-zinc-200">
                  {asset.avgRating.toFixed(1)}
                </span>
                <span className="text-sm text-zinc-500">({asset.ratingCount} reviews)</span>
              </div>
            </div>
            <div>
              <div className="text-sm text-zinc-500">Downloads</div>
              <div className="flex items-center gap-2">
                <Download className="w-4 h-4 text-zinc-400" />
                <span className="text-lg font-semibold text-zinc-200">{asset.downloadCount}</span>
              </div>
            </div>
          </div>

          {/* Description */}
          <div>
            <h3 className="text-sm font-semibold text-zinc-300 mb-2">Description</h3>
            <p className="text-sm text-zinc-400 whitespace-pre-wrap">{asset.description}</p>
          </div>

          {/* Tags */}
          {asset.tags.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-zinc-300 mb-2">Tags</h3>
              <div className="flex flex-wrap gap-2">
                {asset.tags.map((tag) => (
                  <span
                    key={tag}
                    className="px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-xs text-zinc-300"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* AI Badge */}
          {asset.aiGenerated && (
            <div className="flex items-center gap-2 px-3 py-2 bg-purple-900/20 border border-purple-600 rounded">
              <Sparkles className="w-4 h-4 text-purple-400" />
              <span className="text-sm text-purple-300">
                AI-generated {asset.aiProvider ? `by ${asset.aiProvider}` : ''}
              </span>
            </div>
          )}

          {/* Seller */}
          <div>
            <h3 className="text-sm font-semibold text-zinc-300 mb-2">Seller</h3>
            <div className="flex items-center justify-between p-3 bg-zinc-800 border border-zinc-700 rounded">
              <div>
                <div className="text-sm font-semibold text-zinc-200">{asset.seller.name}</div>
                {asset.seller.bio && (
                  <div className="text-xs text-zinc-500 mt-1">{asset.seller.bio}</div>
                )}
              </div>
              {asset.seller.portfolioUrl && (
                <a
                  href={asset.seller.portfolioUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 hover:text-blue-300 transition-colors"
                >
                  <ExternalLink className="w-4 h-4" />
                </a>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3">
            {isPurchased ? (
              <button
                onClick={handleDownload}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-green-600 hover:bg-green-700 text-white font-semibold rounded transition-colors"
              >
                <Download className="w-4 h-4" />
                Download
              </button>
            ) : (
              <button
                onClick={handlePurchase}
                disabled={purchasing}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-700 disabled:text-zinc-500 text-white font-semibold rounded transition-colors"
              >
                <ShoppingCart className="w-4 h-4" />
                {purchasing ? 'Purchasing...' : asset.priceTokens === 0 ? 'Get Free' : 'Purchase'}
              </button>
            )}
          </div>

          {/* Review Form */}
          {isPurchased && (
            <div className="border-t border-zinc-800 pt-6">
              <h3 className="text-sm font-semibold text-zinc-300 mb-3">Write a Review</h3>
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      onClick={() => setRating(star)}
                      className="transition-colors"
                    >
                      <Star
                        className={`w-6 h-6 ${
                          star <= rating
                            ? 'fill-yellow-500 text-yellow-500'
                            : 'text-zinc-600'
                        }`}
                      />
                    </button>
                  ))}
                </div>
                <textarea
                  value={reviewContent}
                  onChange={(e) => setReviewContent(e.target.value)}
                  placeholder="Share your experience with this asset..."
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  rows={3}
                />
                <button
                  onClick={handleReview}
                  disabled={rating === 0 || submittingReview}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-700 disabled:text-zinc-500 text-white font-semibold rounded transition-colors"
                >
                  {submittingReview ? 'Submitting...' : 'Submit Review'}
                </button>
              </div>
            </div>
          )}

          {/* Reviews */}
          {reviews.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-zinc-300 mb-3">Reviews</h3>
              <div className="space-y-3">
                {reviews.map((review) => (
                  <div
                    key={review.id}
                    className="p-3 bg-zinc-800 border border-zinc-700 rounded"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <div className="text-sm font-semibold text-zinc-300">{review.userName}</div>
                        <div className="flex items-center gap-1">
                          {Array.from({ length: review.rating }).map((_, i) => (
                            <Star
                              key={i}
                              className="w-3 h-3 fill-yellow-500 text-yellow-500"
                            />
                          ))}
                        </div>
                      </div>
                      <div className="text-xs text-zinc-500">
                        {new Date(review.createdAt).toLocaleDateString()}
                      </div>
                    </div>
                    {review.content && (
                      <p className="text-sm text-zinc-400">{review.content}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
