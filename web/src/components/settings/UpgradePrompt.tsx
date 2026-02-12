'use client';

import { X, Zap } from 'lucide-react';

interface UpgradePromptProps {
  feature: string;
  requiredTier: string;
  onClose: () => void;
}

export function UpgradePrompt({ feature, requiredTier, onClose }: UpgradePromptProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-full max-w-md rounded-lg bg-[var(--color-bg-secondary)] p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap size={20} className="text-yellow-400" />
            <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
              Upgrade Required
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
          >
            <X size={18} />
          </button>
        </div>
        <p className="mb-4 text-sm text-[var(--color-text-secondary)]">
          <strong>{feature}</strong> requires the{' '}
          <span className="font-semibold text-[var(--color-accent)]">{requiredTier}</span> tier or
          higher.
        </p>
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 rounded-md border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-tertiary)]"
          >
            Maybe Later
          </button>
          <a
            href="/pricing"
            className="flex-1 rounded-md bg-[var(--color-accent)] px-4 py-2 text-center text-sm font-medium text-white hover:opacity-90"
          >
            View Plans
          </a>
        </div>
      </div>
    </div>
  );
}
