'use client';

import { useState, useCallback } from 'react';
import { X, Wand2 } from 'lucide-react';
import { useGenerationStore } from '@/stores/generationStore';
import { useUserStore } from '@/stores/userStore';
import { PALETTES, type PaletteId } from '@/lib/generate/palettes';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

const SIZES = [16, 32, 64, 128] as const;
const STYLES = ['character', 'prop', 'tile', 'icon', 'environment'] as const;
const DITHER_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'bayer4x4', label: 'Bayer 4x4' },
  { value: 'bayer8x8', label: 'Bayer 8x8' },
] as const;

const PRESET_IDS = Object.keys(PALETTES).filter((id) => id !== 'custom') as PaletteId[];

export function GeneratePixelArtDialog({ isOpen, onClose }: Props) {
  const [prompt, setPrompt] = useState('');
  const [targetSize, setTargetSize] = useState<(typeof SIZES)[number]>(32);
  const [palette, setPalette] = useState<PaletteId>('pico-8');
  const [style, setStyle] = useState<(typeof STYLES)[number]>('character');
  const [dithering, setDithering] = useState<string>('none');
  const [ditheringIntensity, setDitheringIntensity] = useState(0.5);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tokenBalance = useUserStore((s) => s.tokenBalance?.total ?? 0);
  const addJob = useGenerationStore((s) => s.addJob);

  const tokenCost = 10; // SDXL default
  const canSubmit = prompt.length >= 3 && tokenBalance >= tokenCost && !isSubmitting;

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;
    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch('/api/generate/pixel-art', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          targetSize,
          palette,
          dithering,
          ditheringIntensity: dithering === 'none' ? 0 : ditheringIntensity,
          style,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        setError(data.error ?? 'Generation failed');
        return;
      }

      addJob({
        id: crypto.randomUUID(),
        jobId: data.jobId,
        type: 'sprite',
        prompt,
        status: data.status === 'completed' ? 'completed' : 'pending',
        progress: 0,
        provider: data.provider,
        createdAt: Date.now(),
        usageId: data.usageId,
        metadata: { targetSize, palette, dithering, ditheringIntensity, style },
      });

      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsSubmitting(false);
    }
  }, [canSubmit, prompt, targetSize, palette, dithering, ditheringIntensity, style, addJob, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-zinc-900 border border-zinc-700 rounded-lg w-[480px] max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-zinc-700">
          <div className="flex items-center gap-2">
            <Wand2 size={18} className="text-blue-400" />
            <h2 className="text-sm font-semibold text-zinc-100">Generate Pixel Art</h2>
          </div>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-200">
            <X size={16} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Prompt */}
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Prompt</label>
            <textarea
              placeholder="Describe your pixel art sprite..."
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-600 rounded px-3 py-2 text-sm text-zinc-100 resize-none"
              rows={3}
            />
          </div>

          {/* Style */}
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Style</label>
            <select
              value={style}
              onChange={(e) => setStyle(e.target.value as typeof style)}
              className="w-full bg-zinc-800 border border-zinc-600 rounded px-3 py-2 text-sm text-zinc-100"
            >
              {STYLES.map((s) => (
                <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
              ))}
            </select>
          </div>

          {/* Size */}
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Target Size</label>
            <div className="flex gap-2">
              {SIZES.map((s) => (
                <button
                  key={s}
                  onClick={() => setTargetSize(s)}
                  className={`px-3 py-1 text-xs rounded border ${
                    targetSize === s
                      ? 'bg-blue-600 border-blue-500 text-white'
                      : 'bg-zinc-800 border-zinc-600 text-zinc-300 hover:border-zinc-400'
                  }`}
                >
                  {s}px
                </button>
              ))}
            </div>
          </div>

          {/* Palette */}
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Palette</label>
            <select
              value={palette}
              onChange={(e) => setPalette(e.target.value as PaletteId)}
              className="w-full bg-zinc-800 border border-zinc-600 rounded px-3 py-2 text-sm text-zinc-100"
            >
              {PRESET_IDS.map((id) => (
                <option key={id} value={id}>
                  {PALETTES[id].name} ({PALETTES[id].colors.length} colors)
                </option>
              ))}
            </select>
            {/* Palette preview */}
            <div className="flex flex-wrap gap-0.5 mt-2">
              {PALETTES[palette].colors.slice(0, 32).map((color, i) => (
                <div
                  key={i}
                  className="w-4 h-4 rounded-sm border border-zinc-600"
                  style={{ backgroundColor: color }}
                />
              ))}
              {PALETTES[palette].colors.length > 32 && (
                <span className="text-xs text-zinc-500 ml-1">
                  +{PALETTES[palette].colors.length - 32} more
                </span>
              )}
            </div>
          </div>

          {/* Dithering */}
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Dithering</label>
            <select
              value={dithering}
              onChange={(e) => setDithering(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-600 rounded px-3 py-2 text-sm text-zinc-100"
            >
              {DITHER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            {dithering !== 'none' && (
              <div className="mt-2">
                <label className="text-xs text-zinc-500">
                  Intensity: {Math.round(ditheringIntensity * 100)}%
                </label>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={ditheringIntensity}
                  onChange={(e) => setDitheringIntensity(parseFloat(e.target.value))}
                  className="w-full"
                />
              </div>
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="text-xs text-red-400 bg-red-900/20 border border-red-800 rounded p-2">
              {error}
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center justify-between pt-2 border-t border-zinc-700">
            <span className="text-xs text-zinc-400">
              Cost: {tokenCost} tokens (Balance: {tokenBalance})
            </span>
            <button
              onClick={handleSubmit}
              disabled={!canSubmit}
              className={`px-4 py-2 text-sm font-medium rounded ${
                canSubmit
                  ? 'bg-blue-600 hover:bg-blue-500 text-white'
                  : 'bg-zinc-700 text-zinc-500 cursor-not-allowed'
              }`}
            >
              {isSubmitting ? 'Generating...' : 'Generate'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
