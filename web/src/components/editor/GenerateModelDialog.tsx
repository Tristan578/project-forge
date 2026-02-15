'use client';

import { useState } from 'react';
import { X, Sparkles } from 'lucide-react';
import { useUserStore } from '@/stores/userStore';

interface GenerateModelDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

type ArtStyle = 'realistic' | 'cartoon' | 'low-poly' | 'pbr';
type Quality = 'standard' | 'high';

export function GenerateModelDialog({ isOpen, onClose }: GenerateModelDialogProps) {
  const [prompt, setPrompt] = useState('');
  const [artStyle, setArtStyle] = useState<ArtStyle>('realistic');
  const [quality, setQuality] = useState<Quality>('standard');
  const [negativePrompt, setNegativePrompt] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const tokenBalance = useUserStore((s) => s.tokenBalance);

  const tokenCost = quality === 'standard' ? 100 : 200;
  const canSubmit =
    prompt.trim().length >= 3 &&
    prompt.trim().length <= 500 &&
    !isSubmitting &&
    tokenBalance !== null &&
    tokenBalance.total >= tokenCost;

  const handleSubmit = async () => {
    if (!canSubmit) return;

    setIsSubmitting(true);
    try {
      const response = await fetch('/api/generate/model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: prompt.trim(),
          mode: 'text-to-3d',
          quality,
          artStyle,
          negativePrompt: negativePrompt.trim() || undefined,
        }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error ?? 'Generation failed');
      }

      // Job started successfully
      onClose();
      setPrompt('');
      setNegativePrompt('');
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="w-full max-w-md rounded-lg bg-zinc-900 shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-700 px-4 py-3">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-purple-400" />
            <h2 className="text-base font-semibold text-zinc-100">Generate 3D Model</h2>
          </div>
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-50"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="space-y-4 p-4">
          {/* Prompt */}
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-300">
              Prompt <span className="text-zinc-600">(3-500 chars)</span>
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              disabled={isSubmitting}
              placeholder="A medieval wooden treasure chest with iron bands and ornate lock"
              className="h-20 w-full resize-none rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-blue-500 disabled:opacity-50"
            />
            <div className="mt-1 text-right text-[10px] text-zinc-600">
              {prompt.length}/500
            </div>
          </div>

          {/* Art Style */}
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-300">Art Style</label>
            <select
              value={artStyle}
              onChange={(e) => setArtStyle(e.target.value as ArtStyle)}
              disabled={isSubmitting}
              className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 outline-none focus:border-blue-500 disabled:opacity-50"
            >
              <option value="realistic">Realistic</option>
              <option value="cartoon">Cartoon</option>
              <option value="low-poly">Low Poly</option>
              <option value="pbr">PBR</option>
            </select>
          </div>

          {/* Quality */}
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-300">Quality</label>
            <select
              value={quality}
              onChange={(e) => setQuality(e.target.value as Quality)}
              disabled={isSubmitting}
              className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 outline-none focus:border-blue-500 disabled:opacity-50"
            >
              <option value="standard">Standard (100 tokens)</option>
              <option value="high">High (200 tokens)</option>
            </select>
          </div>

          {/* Negative Prompt */}
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-300">
              Negative Prompt <span className="text-zinc-600">(optional)</span>
            </label>
            <input
              type="text"
              value={negativePrompt}
              onChange={(e) => setNegativePrompt(e.target.value)}
              disabled={isSubmitting}
              placeholder="What to avoid"
              className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 outline-none focus:border-blue-500 disabled:opacity-50"
            />
          </div>

          {/* Token cost display */}
          <div className="flex items-center justify-between border-t border-zinc-800 pt-3 text-xs">
            <span className="text-zinc-400">Token cost:</span>
            <span className="font-semibold text-zinc-200">{tokenCost}</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-zinc-400">Your balance:</span>
            <span className="font-semibold text-zinc-200">
              {tokenBalance?.total ?? 0}
            </span>
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-2 border-t border-zinc-700 px-4 py-3">
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="flex-1 rounded bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-300 hover:bg-zinc-700 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="flex-1 rounded bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-500 disabled:opacity-50 disabled:hover:bg-purple-600"
          >
            Generate
          </button>
        </div>
      </div>
    </div>
  );
}
