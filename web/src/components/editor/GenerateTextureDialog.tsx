'use client';

import { useState } from 'react';
import { X, Sparkles } from 'lucide-react';
import { useUserStore } from '@/stores/userStore';
import { useEditorStore } from '@/stores/editorStore';

interface GenerateTextureDialogProps {
  isOpen: boolean;
  onClose: () => void;
  entityId: string;
}

type Resolution = '1024' | '2048';
type TextureStyle = 'realistic' | 'stylized' | 'cartoon';

export function GenerateTextureDialog({ isOpen, onClose, entityId }: GenerateTextureDialogProps) {
  const [prompt, setPrompt] = useState('');
  const [resolution, setResolution] = useState<Resolution>('1024');
  const [style, setStyle] = useState<TextureStyle>('realistic');
  const [tiling, setTiling] = useState(true);
  const [maps, setMaps] = useState({
    albedo: true,
    normal: true,
    metallicRoughness: true,
    emissive: false,
    ao: true,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const tokenBalance = useUserStore((s) => s.tokenBalance);
  const primaryName = useEditorStore((s) => s.primaryName);

  const tokenCost = 30;
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
      const response = await fetch('/api/generate/texture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: prompt.trim(),
          resolution,
          generateMaps: maps,
          style,
          tiling,
          entityId,
        }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error ?? 'Generation failed');
      }

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
            <h2 className="text-base font-semibold text-zinc-100">Generate Texture</h2>
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
              placeholder="Weathered red brick wall with moss"
              className="h-20 w-full resize-none rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-blue-500 disabled:opacity-50"
            />
            <div className="mt-1 text-right text-[10px] text-zinc-600">
              {prompt.length}/500
            </div>
          </div>

          {/* Resolution */}
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-300">Resolution</label>
            <select
              value={resolution}
              onChange={(e) => setResolution(e.target.value as Resolution)}
              disabled={isSubmitting}
              className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 outline-none focus:border-blue-500 disabled:opacity-50"
            >
              <option value="1024">1024x1024</option>
              <option value="2048">2048x2048</option>
            </select>
          </div>

          {/* Style */}
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-300">Style</label>
            <select
              value={style}
              onChange={(e) => setStyle(e.target.value as TextureStyle)}
              disabled={isSubmitting}
              className="w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 outline-none focus:border-blue-500 disabled:opacity-50"
            >
              <option value="realistic">Realistic</option>
              <option value="stylized">Stylized</option>
              <option value="cartoon">Cartoon</option>
            </select>
          </div>

          {/* Tiling */}
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="tiling"
              checked={tiling}
              onChange={(e) => setTiling(e.target.checked)}
              disabled={isSubmitting}
              className="h-3.5 w-3.5 rounded border-zinc-600 bg-zinc-800 text-blue-500 focus:ring-1 focus:ring-blue-500 focus:ring-offset-0"
            />
            <label htmlFor="tiling" className="text-xs text-zinc-300">
              Seamless tiling
            </label>
          </div>

          {/* Maps to generate */}
          <div>
            <label className="mb-2 block text-xs font-medium text-zinc-300">Maps to generate</label>
            <div className="space-y-2">
              {[
                { key: 'albedo' as const, label: 'Albedo' },
                { key: 'normal' as const, label: 'Normal' },
                { key: 'metallicRoughness' as const, label: 'Metallic/Roughness' },
                { key: 'emissive' as const, label: 'Emissive' },
                { key: 'ao' as const, label: 'AO' },
              ].map(({ key, label }) => (
                <div key={key} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id={key}
                    checked={maps[key]}
                    onChange={(e) => setMaps({ ...maps, [key]: e.target.checked })}
                    disabled={isSubmitting}
                    className="h-3.5 w-3.5 rounded border-zinc-600 bg-zinc-800 text-blue-500 focus:ring-1 focus:ring-blue-500 focus:ring-offset-0"
                  />
                  <label htmlFor={key} className="text-xs text-zinc-300">
                    {label}
                  </label>
                </div>
              ))}
            </div>
          </div>

          {/* Target entity */}
          <div className="rounded border border-zinc-800 bg-zinc-850 p-2 text-xs text-zinc-400">
            Apply to: <span className="font-medium text-zinc-300">{primaryName || 'Selected entity'}</span>
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
