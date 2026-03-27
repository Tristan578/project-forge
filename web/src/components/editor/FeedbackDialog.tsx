'use client';

import { useState, useCallback } from 'react';
import { X, Bug, Lightbulb, MessageSquare, Send, CheckCircle } from 'lucide-react';
import { useDialogA11y } from '@/hooks/useDialogA11y';

type FeedbackType = 'bug' | 'feature' | 'general';

interface FeedbackDialogProps {
  open: boolean;
  onClose: () => void;
}

const TYPES: { value: FeedbackType; label: string; icon: typeof Bug; color: string }[] = [
  { value: 'bug', label: 'Bug Report', icon: Bug, color: 'text-red-400' },
  { value: 'feature', label: 'Feature Request', icon: Lightbulb, color: 'text-amber-400' },
  { value: 'general', label: 'General Feedback', icon: MessageSquare, color: 'text-blue-400' },
];

export function FeedbackDialog({ open, onClose }: FeedbackDialogProps) {
  const [type, setType] = useState<FeedbackType>('general');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset state when dialog opens
  const [prevOpen, setPrevOpen] = useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (open) {
      setType('general');
      setDescription('');
      setSubmitted(false);
      setError(null);
    }
  }

  const dialogRef = useDialogA11y(onClose);

  const handleSubmit = useCallback(async () => {
    if (description.trim().length < 10) {
      setError('Please provide at least 10 characters of feedback.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          description: description.trim(),
          metadata: {
            url: window.location.href,
            userAgent: navigator.userAgent,
            viewport: `${window.innerWidth}x${window.innerHeight}`,
          },
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit feedback');
    } finally {
      setSubmitting(false);
    }
  }, [type, description]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="feedback-dialog-title"
        className="mx-4 w-full max-w-md rounded-lg border border-zinc-700 bg-zinc-900 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {submitted ? (
          // Success state
          <div className="flex flex-col items-center gap-3 py-6">
            <CheckCircle size={40} className="text-green-400" />
            <h2 id="feedback-dialog-title" className="text-lg font-semibold text-zinc-100">Thanks for your feedback!</h2>
            <p className="text-center text-sm text-zinc-400">
              Your {type === 'bug' ? 'bug report' : type === 'feature' ? 'feature request' : 'feedback'} has been submitted.
            </p>
            <button
              onClick={onClose}
              className="mt-2 rounded bg-zinc-700 px-4 py-1.5 text-sm font-medium text-zinc-200 hover:bg-zinc-600 transition-colors"
            >
              Close
            </button>
          </div>
        ) : (
          <>
            <div className="mb-4 flex items-center justify-between">
              <h2 id="feedback-dialog-title" className="text-base font-semibold text-zinc-100">Send Feedback</h2>
              <button
                onClick={onClose}
                aria-label="Close feedback dialog"
                className="rounded p-1 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
              >
                <X size={16} />
              </button>
            </div>

            {/* Type selector */}
            <div className="mb-4 flex gap-2">
              {TYPES.map((t) => {
                const Icon = t.icon;
                const selected = type === t.value;
                return (
                  <button
                    key={t.value}
                    onClick={() => setType(t.value)}
                    aria-pressed={selected}
                    className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                      selected
                        ? 'border-zinc-600 bg-zinc-800 text-zinc-100'
                        : 'border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-300'
                    }`}
                  >
                    <Icon size={14} className={selected ? t.color : ''} />
                    {t.label}
                  </button>
                );
              })}
            </div>

            {/* Description */}
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              aria-label="Feedback description"
              aria-describedby="feedback-char-count"
              placeholder={
                type === 'bug'
                  ? 'Describe the bug: what happened, what you expected, and steps to reproduce...'
                  : type === 'feature'
                    ? 'Describe the feature you\'d like to see...'
                    : 'Share your thoughts, suggestions, or questions...'
              }
              className="mb-3 h-32 w-full resize-none rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:border-zinc-600 focus:outline-none"
              maxLength={5000}
              autoFocus
            />

            {/* Character count */}
            <div id="feedback-char-count" className="mb-3 flex items-center justify-between">
              <span className="text-[10px] text-zinc-400">
                {description.length}/5000
              </span>
              {description.trim().length > 0 && description.trim().length < 10 && (
                <span className="text-[10px] text-amber-500">
                  Minimum 10 characters
                </span>
              )}
            </div>

            {/* Error message */}
            {error && (
              <div role="alert" className="mb-3 rounded border border-red-800/50 bg-red-900/20 px-3 py-2 text-xs text-red-400">
                {error}
              </div>
            )}

            {/* Submit button */}
            <button
              onClick={handleSubmit}
              disabled={submitting || description.trim().length < 10}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {submitting ? (
                <span className="animate-pulse">Submitting...</span>
              ) : (
                <>
                  <Send size={14} />
                  Submit Feedback
                </>
              )}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
