'use client';

import { useState } from 'react';
import { X, Sparkles } from 'lucide-react';
import { useUserStore } from '@/stores/userStore';
import { useGenerationStore } from '@/stores/generationStore';

interface GenerateSpriteDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

type SpriteStyle = 'pixel-art' | 'hand-drawn' | 'vector' | 'realistic';
type SpriteSize = '32x32' | '64x64' | '128x128' | '256x256' | '512x512' | '1024x1024';
type TabType = 'single' | 'sheet' | 'tileset';

export function GenerateSpriteDialog({ isOpen, onClose }: GenerateSpriteDialogProps) {
  const [activeTab, setActiveTab] = useState<TabType>('single');
  const [prompt, setPrompt] = useState('');
  const [style, setStyle] = useState<SpriteStyle>('pixel-art');
  const [size, setSize] = useState<SpriteSize>('64x64');
  const [frameCount, setFrameCount] = useState(4);
  const [tileSize, setTileSize] = useState<16 | 32 | 48 | 64>(32);
  const [gridSize, setGridSize] = useState<'4x4' | '8x8' | '16x16'>('8x8');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const tokenBalance = useUserStore((s) => s.tokenBalance);
  const addJob = useGenerationStore((s) => s.addJob);

  const tokenCost = activeTab === 'single' ? 15 : activeTab === 'sheet' ? frameCount * 15 : 50;
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
      let endpoint = '';
      let body: Record<string, unknown> = {};

      if (activeTab === 'single') {
        endpoint = '/api/generate/sprite';
        body = {
          prompt: prompt.trim(),
          style,
          size,
          removeBackground: true,
        };
      } else if (activeTab === 'sheet') {
        endpoint = '/api/generate/sprite-sheet';
        body = {
          sourceAssetId: 'temp_asset_id', // TODO: Get from asset selector
          frameCount,
          style,
          size: size.split('x')[0] + 'x' + size.split('x')[0], // Force square
        };
      } else {
        endpoint = '/api/generate/tileset-gen';
        body = {
          prompt: prompt.trim(),
          tileSize,
          gridSize,
        };
      }

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error ?? 'Generation failed');
      }

      const data = await response.json();

      // Add job to generation store
      addJob({
        id: crypto.randomUUID(),
        jobId: data.jobId,
        type: activeTab === 'single' ? 'texture' : 'texture', // TODO: Add sprite types
        prompt: prompt.trim(),
        status: 'pending',
        progress: 0,
        provider: data.provider,
        createdAt: Date.now(),
      });

      // Job started successfully
      onClose();
      setPrompt('');
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
            <h2 className="text-base font-semibold text-zinc-100">Generate Sprite</h2>
          </div>
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-50"
          >
            <X size={18} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-zinc-800">
          <button
            onClick={() => setActiveTab('single')}
            className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === 'single'
                ? 'border-b-2 border-purple-500 text-purple-400'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Single Sprite
          </button>
          <button
            onClick={() => setActiveTab('sheet')}
            className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === 'sheet'
                ? 'border-b-2 border-purple-500 text-purple-400'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Sprite Sheet
          </button>
          <button
            onClick={() => setActiveTab('tileset')}
            className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === 'tileset'
                ? 'border-b-2 border-purple-500 text-purple-400'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Tileset
          </button>
        </div>

        {/* Body */}
        <div className="space-y-4 p-4">
          {/* Prompt (all tabs) */}
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-300">
              Prompt <span className="text-zinc-600">(3-500 chars)</span>
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              disabled={isSubmitting}
              placeholder={
                activeTab === 'single'
                  ? 'Pixel art wizard character, 64x64'
                  : activeTab === 'sheet'
                    ? 'Walk cycle animation'
                    : 'Grass terrain tileset'
              }
              className="h-20 w-full resize-none rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-blue-500 disabled:opacity-50"
            />
            <div className="mt-1 text-right text-[10px] text-zinc-600">
              {prompt.length}/500
            </div>
          </div>

          {/* Style (single and sheet) */}
          {(activeTab === 'single' || activeTab === 'sheet') && (
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-300">Style</label>
              <select
                value={style}
                onChange={(e) => setStyle(e.target.value as SpriteStyle)}
                disabled={isSubmitting}
                className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 outline-none focus:border-blue-500 disabled:opacity-50"
              >
                <option value="pixel-art">Pixel Art</option>
                <option value="hand-drawn">Hand-Drawn</option>
                <option value="vector">Vector</option>
                <option value="realistic">Realistic</option>
              </select>
            </div>
          )}

          {/* Size (single and sheet) */}
          {(activeTab === 'single' || activeTab === 'sheet') && (
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-300">Size</label>
              <select
                value={size}
                onChange={(e) => setSize(e.target.value as SpriteSize)}
                disabled={isSubmitting}
                className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 outline-none focus:border-blue-500 disabled:opacity-50"
              >
                <option value="32x32">32x32</option>
                <option value="64x64">64x64</option>
                <option value="128x128">128x128</option>
                <option value="256x256">256x256</option>
                {activeTab === 'single' && <option value="512x512">512x512</option>}
                {activeTab === 'single' && <option value="1024x1024">1024x1024</option>}
              </select>
            </div>
          )}

          {/* Frame count (sheet only) */}
          {activeTab === 'sheet' && (
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-300">
                Frame Count: {frameCount}
              </label>
              <input
                type="range"
                min="2"
                max="8"
                value={frameCount}
                onChange={(e) => setFrameCount(Number(e.target.value))}
                disabled={isSubmitting}
                className="w-full"
              />
            </div>
          )}

          {/* Tile size (tileset only) */}
          {activeTab === 'tileset' && (
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-300">Tile Size</label>
              <select
                value={tileSize}
                onChange={(e) => setTileSize(Number(e.target.value) as 16 | 32 | 48 | 64)}
                disabled={isSubmitting}
                className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 outline-none focus:border-blue-500 disabled:opacity-50"
              >
                <option value="16">16x16</option>
                <option value="32">32x32</option>
                <option value="48">48x48</option>
                <option value="64">64x64</option>
              </select>
            </div>
          )}

          {/* Grid size (tileset only) */}
          {activeTab === 'tileset' && (
            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-300">Grid Size</label>
              <select
                value={gridSize}
                onChange={(e) => setGridSize(e.target.value as '4x4' | '8x8' | '16x16')}
                disabled={isSubmitting}
                className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 outline-none focus:border-blue-500 disabled:opacity-50"
              >
                <option value="4x4">4x4 (16 tiles)</option>
                <option value="8x8">8x8 (64 tiles)</option>
                <option value="16x16">16x16 (256 tiles)</option>
              </select>
            </div>
          )}

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
