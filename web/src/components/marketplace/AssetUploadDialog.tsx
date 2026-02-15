'use client';

import React, { useState } from 'react';
import { X } from 'lucide-react';

interface AssetUploadDialogProps {
  onClose: () => void;
  onSuccess: () => void;
}

const CATEGORIES = [
  { id: 'model_3d', label: '3D Model' },
  { id: 'sprite', label: 'Sprite' },
  { id: 'texture', label: 'Texture' },
  { id: 'audio', label: 'Audio' },
  { id: 'script', label: 'Script' },
  { id: 'prefab', label: 'Prefab' },
  { id: 'template', label: 'Template' },
  { id: 'shader', label: 'Shader' },
  { id: 'animation', label: 'Animation' },
];

export function AssetUploadDialog({ onClose, onSuccess }: AssetUploadDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('model_3d');
  const [priceTokens, setPriceTokens] = useState(0);
  const [license, setLicense] = useState<'standard' | 'extended'>('standard');
  const [tags, setTags] = useState('');
  const [aiGenerated, setAiGenerated] = useState(false);
  const [aiProvider, setAiProvider] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!name || !description) {
      alert('Name and description are required');
      return;
    }

    setSubmitting(true);

    try {
      const res = await fetch('/api/marketplace/seller/assets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          description,
          category,
          priceTokens,
          license,
          tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed to create listing' }));
        throw new Error(err.error);
      }

      onSuccess();
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to create listing');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-zinc-900 rounded-lg border border-zinc-700 w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-zinc-800">
          <h2 className="text-xl font-bold text-zinc-200">Create Asset Listing</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-zinc-800 rounded transition-colors"
          >
            <X className="w-5 h-5 text-zinc-400" />
          </button>
        </div>

        {/* Form */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          <div>
            <label className="block text-sm font-semibold text-zinc-300 mb-1">
              Asset Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Awesome Asset"
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-zinc-300 mb-1">
              Description <span className="text-red-500">*</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe your asset, its features, and usage..."
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              rows={4}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-zinc-300 mb-1">Category</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded text-sm text-zinc-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {CATEGORIES.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-semibold text-zinc-300 mb-1">
                Price (Tokens)
              </label>
              <input
                type="number"
                value={priceTokens}
                onChange={(e) => setPriceTokens(Math.max(0, parseInt(e.target.value) || 0))}
                min="0"
                placeholder="0 for free"
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-zinc-300 mb-1">License</label>
            <select
              value={license}
              onChange={(e) => setLicense(e.target.value as 'standard' | 'extended')}
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded text-sm text-zinc-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="standard">Standard</option>
              <option value="extended">Extended</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-semibold text-zinc-300 mb-1">
              Tags (comma-separated)
            </label>
            <input
              type="text"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="fantasy, low-poly, environment"
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="ai-generated"
              checked={aiGenerated}
              onChange={(e) => setAiGenerated(e.target.checked)}
              className="w-4 h-4"
            />
            <label htmlFor="ai-generated" className="text-sm text-zinc-300">
              This asset was AI-generated
            </label>
          </div>

          {aiGenerated && (
            <div>
              <label className="block text-sm font-semibold text-zinc-300 mb-1">
                AI Provider (optional)
              </label>
              <input
                type="text"
                value={aiProvider}
                onChange={(e) => setAiProvider(e.target.value)}
                placeholder="e.g., Meshy, MidJourney, etc."
                className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          )}

          <div className="bg-yellow-900/20 border border-yellow-600 p-3 rounded">
            <p className="text-xs text-yellow-300">
              Note: This creates a draft listing. You&apos;ll need to upload preview images and asset
              files separately before publishing.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-4 border-t border-zinc-800">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || !name || !description}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-700 disabled:text-zinc-500 text-white rounded transition-colors"
          >
            {submitting ? 'Creating...' : 'Create Listing'}
          </button>
        </div>
      </div>
    </div>
  );
}
