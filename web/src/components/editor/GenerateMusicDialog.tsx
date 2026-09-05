'use client';

import { useState, useCallback } from 'react';
import { X, Sparkles, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useUserStore } from '@/stores/userStore';
import { useEditorStore } from '@/stores/editorStore';
import { useDialogA11y } from '@/hooks/useDialogA11y';
import { useAIGeneration } from '@/hooks/useAIGeneration';
import { useGenerationGate } from '@/hooks/useGenerationGate';
import { GenerationUnavailableNotice } from './GenerationUnavailableNotice';
import { attachGeneratedAudio } from '@/lib/generate/attachGeneratedAudio';
import { EmptyArtifactError } from '@/lib/generate/emptyArtifactError';
import { trackJob, makeJobId } from '@/lib/chat/handlers/generationHandlers';
import { DIRECT_CAPABILITY_PROVIDER } from '@/lib/config/providers';

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
  // Typed: `execute` resolves to the sentence the success toast reports.
  const { execute, cancel, isLoading: isSubmitting } = useAIGeneration<string>({
    onError: (msg) => toast.error(msg),
  });

  const tokenBalance = useUserStore((s) => s.tokenBalance);
  const primaryName = useEditorStore((s) => s.primaryName);
  const dialogRef = useDialogA11y(onClose);

  const tokenCost = 80;
  // Capability gate (#9117): blocked only on a positive "unavailable" report.
  const gate = useGenerationGate('music-generation');
  const canSubmit =
    !gate.blocked &&
    prompt.trim().length >= 3 &&
    prompt.trim().length <= 500 &&
    !isSubmitting &&
    tokenBalance !== null &&
    tokenBalance.total >= tokenCost;

  const handleClose = useCallback(() => {
    cancel();
    onClose();
  }, [cancel, onClose]);

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;

    const result = await execute(async (signal) => {
      const response = await fetch('/api/generate/music', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: prompt.trim(),
          durationSeconds: duration,
          instrumental,
          entityId: attachToEntity && entityId ? entityId : undefined,
        }),
        signal,
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error ?? 'Generation failed');
      }

      // Discarding this body — which is what this did — spends the user's
      // tokens and produces nothing: on the sync path the only copy of the
      // track is thrown away, and on the async path the job is never tracked,
      // so nothing ever polls for it and the finished track never arrives.
      const data = (await response.json()) as Record<string, unknown>;
      const target = attachToEntity && entityId ? entityId : undefined;

      // `typeof`, not truthiness — the same guard the chat tool uses to pick
      // between the sync and async shapes.
      if (typeof data.audioBase64 === 'string' && data.audioBase64.length > 0) {
        const assetName = attachGeneratedAudio({
          kind: 'music',
          prompt: prompt.trim(),
          audioBase64: data.audioBase64,
          entityId: target,
          sink: useEditorStore.getState(),
        });
        return target
          ? `Music generated and attached as "${assetName}".`
          : `Music generated and imported as "${assetName}".`;
      }

      if (typeof data.jobId !== 'string' || data.jobId.length === 0) {
        throw new EmptyArtifactError('Music', 'audio');
      }

      trackJob({
        jobId: makeJobId(),
        providerJobId: data.jobId,
        type: 'music',
        prompt: prompt.trim(),
        // `typeof` and not a cast: `data` is a parsed API response, so a cast
        // asserts a shape rather than checking one. `usageId` is the key the
        // async refund is keyed on — a non-string surviving as one is a job
        // that can never be refunded.
        provider: typeof data.provider === 'string' && data.provider.length > 0
          ? data.provider
          : DIRECT_CAPABILITY_PROVIDER.music,
        entityId: target,
        usageId: typeof data.usageId === 'string' ? data.usageId : undefined,
        durable: data.durable === true,
        autoPlace: !!target,
        targetEntityId: target,
      });
      return 'Music generation started. It will be imported when it finishes.';
    });

    if (result) {
      toast.success(result);
      onClose();
      setPrompt('');
    }
  }, [canSubmit, execute, prompt, duration, instrumental, attachToEntity, entityId, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="generate-music-dialog-title" aria-describedby={gate.blocked ? 'generate-music-unavailable' : undefined}
        className="w-full max-w-md rounded-lg bg-zinc-900 shadow-xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-700 px-4 py-3">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-purple-400" />
            <h2 id="generate-music-dialog-title" className="text-base font-semibold text-zinc-100">Generate Music</h2>
          </div>
          <button
            onClick={handleClose}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="space-y-4 p-4">
          {/* Unavailable state (#9117): the server refuses this capability before any charge. */}
          {gate.blocked && <GenerationUnavailableNotice id="generate-music-unavailable" reason={gate.reason} />}

          {/* Prompt */}
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-300">
              Prompt <span className="text-zinc-400">(3-500 chars)</span>
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              disabled={isSubmitting || gate.blocked}
              placeholder="Upbeat chiptune adventure music"
              className="h-20 w-full resize-none rounded border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-blue-500 disabled:opacity-50"
            />
            <div className="mt-1 text-right text-[10px] text-zinc-400">
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
              disabled={isSubmitting || gate.blocked}
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
              disabled={isSubmitting || gate.blocked}
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
                disabled={isSubmitting || gate.blocked}
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
            onClick={handleClose}
            className="flex-1 rounded bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-300 hover:bg-zinc-700"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit} aria-describedby={gate.blocked ? 'generate-music-unavailable' : undefined}
            aria-busy={isSubmitting}
            className="flex flex-1 items-center justify-center gap-2 rounded bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-500 disabled:opacity-50 disabled:hover:bg-purple-600"
          >
            {isSubmitting ? (
              <>
                <Loader2 size={14} className="animate-spin" aria-hidden="true" />
                Submitting...
              </>
            ) : (
              'Generate'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
