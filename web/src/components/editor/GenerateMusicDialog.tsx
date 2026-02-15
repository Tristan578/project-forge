'use client';

import { useState } from 'react';
import { X, Sparkles } from 'lucide-react';
import { useUserStore } from '@/stores/userStore';
import { useEditorStore } from '@/stores/editorStore';

interface GenerateMusicDialogProps {
  isOpen: boolean;
  onClose: () => void;
  entityId?: string;
}

export function GenerateMusicDialog({ isOpen, onClose, entityId }: GenerateMusicDialogProps) {
  const [prompt, setPrompt] = useState('');
  const [duration, setDuration] = useState(30);
  const [instrumental, setInstrumental] = useState(true);
  const [attachToEntity, setAttachToEntity] = useState(!!entityId);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const tokenBalance = useUserStore((s) => s.tokenBalance);
  const primaryName = useEditorStore((s) => s.primaryName);

  const tokenCost = 80;
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
      const response = await fetch('/api/generate/music', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: prompt.trim(),
          durationSeconds: duration,
          instrumental,
          entityId: attachToEntity && entityId ? entityId : undefined,
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
            <h2 className="text-base font-semibold text-zinc-100">Generate Music</h2>
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
              placeholder="Upbeat chiptune adventure music"
              className="h-20 w-full resize-none rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-blue-500 disabled:opacity-50"
            />
            <div className="mt-1 text-right text-[10px] text-zinc-600">
              {prompt.length}/500
            </div>
          </div>

          {/* Duration */}
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-300">
              Duration: {duration}s
            </label>
            <input
              type="range"
              min={15}
              max={120}
              step={5}
              value={duration}
              onChange={(e) => setDuration(parseInt(e.target.value))}
              disabled={isSubmitting}
              className="h-1 w-full cursor-pointer appearance-none rounded bg-zinc-700
                [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3
                [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full
                [&::-webkit-slider-thumb]:bg-zinc-300"
            />
          </div>

          {/* Instrumental */}
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="instrumental"
              checked={instrumental}
              onChange={(e) => setInstrumental(e.target.checked)}
              disabled={isSubmitting}
              className="h-3.5 w-3.5 rounded border-zinc-600 bg-zinc-800 text-blue-500 focus:ring-1 focus:ring-blue-500 focus:ring-offset-0"
            />
            <label htmlFor="instrumental" className="text-xs text-zinc-300">
              Instrumental (no vocals)
            </label>
          </div>

          {/* Auto-attach option */}
          {entityId && (
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="attach"
                checked={attachToEntity}
                onChange={(e) => setAttachToEntity(e.target.checked)}
                disabled={isSubmitting}
                className="h-3.5 w-3.5 rounded border-zinc-600 bg-zinc-800 text-blue-500 focus:ring-1 focus:ring-blue-500 focus:ring-offset-0"
              />
              <label htmlFor="attach" className="text-xs text-zinc-300">
                Auto-attach to <span className="font-medium">{primaryName || 'selected entity'}</span>
              </label>
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
