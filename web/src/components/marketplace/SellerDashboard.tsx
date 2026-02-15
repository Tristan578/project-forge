'use client';

import React, { useEffect, useState } from 'react';
import { Plus, Edit, Trash2, Eye, TrendingUp } from 'lucide-react';
import { AssetUploadDialog } from './AssetUploadDialog';

interface SellerAsset {
  id: string;
  name: string;
  category: string;
  status: string;
  priceTokens: number;
  downloadCount: number;
  avgRating: number;
  ratingCount: number;
}

interface SellerProfile {
  displayName: string;
  bio: string;
  totalEarnings: number;
  totalSales: number;
}

export function SellerDashboard() {
  const [profile, setProfile] = useState<SellerProfile | null>(null);
  const [assets, setAssets] = useState<SellerAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [showUpload, setShowUpload] = useState(false);
  const [editingProfile, setEditingProfile] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [portfolioUrl, setPortfolioUrl] = useState('');

  useEffect(() => {
    fetchProfile();
    fetchAssets();
  }, []);

  const fetchProfile = async () => {
    try {
      const res = await fetch('/api/marketplace/seller');
      if (res.ok) {
        const data = await res.json();
        setProfile(data.profile);
        if (data.profile) {
          setDisplayName(data.profile.displayName || '');
          setBio(data.profile.bio || '');
          setPortfolioUrl(data.profile.portfolioUrl || '');
        }
      }
    } catch {
      // Silent fail
    }
  };

  const fetchAssets = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/marketplace/seller/assets');
      if (res.ok) {
        const data = await res.json();
        setAssets(data.assets || []);
      }
    } catch {
      // Silent fail
    } finally {
      setLoading(false);
    }
  };

  const handleSaveProfile = async () => {
    try {
      const res = await fetch('/api/marketplace/seller', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName, bio, portfolioUrl }),
      });

      if (res.ok) {
        await fetchProfile();
        setEditingProfile(false);
      } else {
        alert('Failed to save profile');
      }
    } catch {
      alert('Error saving profile');
    }
  };

  const STATUS_COLORS: Record<string, string> = {
    draft: 'bg-zinc-600',
    pending_review: 'bg-yellow-600',
    published: 'bg-green-600',
    rejected: 'bg-red-600',
    removed: 'bg-zinc-700',
  };

  return (
    <div className="h-full overflow-y-auto bg-zinc-900 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-zinc-200">Seller Dashboard</h1>
          <button
            onClick={() => setShowUpload(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
          >
            <Plus className="w-4 h-4" />
            Create Listing
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-zinc-800 border border-zinc-700 rounded-lg p-4">
            <div className="flex items-center gap-2 text-zinc-400 mb-2">
              <TrendingUp className="w-4 h-4" />
              <span className="text-sm">Total Earnings</span>
            </div>
            <div className="text-3xl font-bold text-zinc-200">
              {profile?.totalEarnings || 0} tokens
            </div>
          </div>
          <div className="bg-zinc-800 border border-zinc-700 rounded-lg p-4">
            <div className="flex items-center gap-2 text-zinc-400 mb-2">
              <Eye className="w-4 h-4" />
              <span className="text-sm">Total Sales</span>
            </div>
            <div className="text-3xl font-bold text-zinc-200">{profile?.totalSales || 0}</div>
          </div>
        </div>

        {/* Profile */}
        <div className="bg-zinc-800 border border-zinc-700 rounded-lg p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-zinc-200">Seller Profile</h2>
            <button
              onClick={() => setEditingProfile(!editingProfile)}
              className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
            >
              {editingProfile ? 'Cancel' : 'Edit'}
            </button>
          </div>

          {editingProfile ? (
            <div className="space-y-3">
              <div>
                <label className="block text-sm text-zinc-400 mb-1">Display Name</label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded text-sm text-zinc-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm text-zinc-400 mb-1">Bio</label>
                <textarea
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded text-sm text-zinc-200 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  rows={3}
                />
              </div>
              <div>
                <label className="block text-sm text-zinc-400 mb-1">Portfolio URL</label>
                <input
                  type="url"
                  value={portfolioUrl}
                  onChange={(e) => setPortfolioUrl(e.target.value)}
                  className="w-full px-3 py-2 bg-zinc-900 border border-zinc-700 rounded text-sm text-zinc-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <button
                onClick={handleSaveProfile}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
              >
                Save Profile
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <div>
                <span className="text-sm text-zinc-400">Name: </span>
                <span className="text-sm text-zinc-200">{profile?.displayName || 'Not set'}</span>
              </div>
              {profile?.bio && (
                <div>
                  <span className="text-sm text-zinc-400">Bio: </span>
                  <span className="text-sm text-zinc-200">{profile.bio}</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Assets */}
        <div className="bg-zinc-800 border border-zinc-700 rounded-lg p-4">
          <h2 className="text-lg font-semibold text-zinc-200 mb-4">Your Listings</h2>

          {loading ? (
            <div className="text-center py-8 text-zinc-500">Loading...</div>
          ) : assets.length === 0 ? (
            <div className="text-center py-8 text-zinc-500">
              No listings yet. Create your first asset!
            </div>
          ) : (
            <div className="space-y-2">
              {assets.map((asset) => (
                <div
                  key={asset.id}
                  className="flex items-center justify-between p-3 bg-zinc-900 border border-zinc-700 rounded hover:border-zinc-600 transition-colors"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-zinc-200">{asset.name}</h3>
                      <span
                        className={`${
                          STATUS_COLORS[asset.status] || 'bg-zinc-600'
                        } text-white text-xs px-2 py-0.5 rounded`}
                      >
                        {asset.status.replace('_', ' ')}
                      </span>
                    </div>
                    <div className="flex items-center gap-4 mt-1 text-xs text-zinc-500">
                      <span>{asset.category.replace('_', ' ')}</span>
                      <span>
                        {asset.priceTokens === 0 ? 'Free' : `${asset.priceTokens} tokens`}
                      </span>
                      <span>{asset.downloadCount} downloads</span>
                      {asset.ratingCount > 0 && (
                        <span>{asset.avgRating.toFixed(1)} stars ({asset.ratingCount})</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button className="p-2 hover:bg-zinc-800 rounded transition-colors">
                      <Edit className="w-4 h-4 text-zinc-400" />
                    </button>
                    <button className="p-2 hover:bg-zinc-800 rounded transition-colors">
                      <Trash2 className="w-4 h-4 text-red-400" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {showUpload && (
        <AssetUploadDialog
          onClose={() => setShowUpload(false)}
          onSuccess={() => {
            setShowUpload(false);
            fetchAssets();
          }}
        />
      )}
    </div>
  );
}
