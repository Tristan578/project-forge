'use client';

import { useCallback } from 'react';
import { AlertCircle, ArrowUpCircle, CreditCard, Key } from 'lucide-react';
import { useChatStore } from '@/stores/chatStore';
import { useUserStore } from '@/stores/userStore';

const TIER_LABELS: Record<string, string> = {
  starter: 'Starter',
  hobbyist: 'Hobbyist',
  creator: 'Creator',
  pro: 'Pro',
};

/**
 * Modal shown when the user has 0 tokens and attempts to send an AI message.
 * Cannot be dismissed without choosing an action — forces a resolution path.
 */
export function TokenDepletedModal() {
  const showModal = useChatStore((s) => s.showTokenDepletedModal);
  const setShowModal = useChatStore((s) => s.setShowTokenDepletedModal);
  const tier = useUserStore((s) => s.tier);

  const tierLabel = TIER_LABELS[tier] ?? tier;

  const handleUpgrade = useCallback(() => {
    setShowModal(false);
    window.location.href = '/pricing';
  }, [setShowModal]);

  const handleBuyTokens = useCallback(() => {
    setShowModal(false);
    window.location.href = '/settings/billing';
  }, [setShowModal]);

  const handleByok = useCallback(() => {
    setShowModal(false);
    window.location.href = '/settings/api-keys';
  }, [setShowModal]);

  if (!showModal) return null;

  return (
    <>
      {/* Backdrop — intentionally non-dismissible */}
      <div
        className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
        aria-hidden="true"
      />

      {/* Modal */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="token-depleted-title"
        data-testid="token-depleted-modal"
        className="fixed left-1/2 top-1/2 z-50 w-[480px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-zinc-700 bg-zinc-900 p-6 shadow-2xl"
      >
        {/* Icon + heading */}
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-900/60">
            <AlertCircle size={24} className="text-red-400" />
          </div>
          <h2
            id="token-depleted-title"
            className="text-lg font-semibold text-zinc-100"
          >
            You&apos;re out of tokens
          </h2>
          <p className="text-sm text-zinc-400">
            Your <span className="font-medium text-zinc-300">{tierLabel}</span> plan
            has no tokens remaining. Choose an option below to continue using AI
            features.
          </p>
        </div>

        {/* Actions */}
        <div className="mt-6 flex flex-col gap-3">
          <button
            data-testid="upgrade-plan-button"
            onClick={handleUpgrade}
            className="flex items-center gap-3 rounded-md bg-blue-600 px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-zinc-900"
          >
            <ArrowUpCircle size={16} className="shrink-0" />
            <span className="flex-1 text-left">Upgrade Plan</span>
            <span className="text-xs text-blue-200">More monthly tokens</span>
          </button>

          <button
            data-testid="buy-token-pack-button"
            onClick={handleBuyTokens}
            className="flex items-center gap-3 rounded-md bg-zinc-700 px-4 py-3 text-sm font-medium text-zinc-100 transition-colors hover:bg-zinc-600 focus:outline-none focus:ring-2 focus:ring-zinc-500 focus:ring-offset-2 focus:ring-offset-zinc-900"
          >
            <CreditCard size={16} className="shrink-0" />
            <span className="flex-1 text-left">Buy Token Pack</span>
            <span className="text-xs text-zinc-400">One-time add-on</span>
          </button>

          <button
            data-testid="byok-link"
            onClick={handleByok}
            className="flex items-center gap-3 rounded-md px-4 py-3 text-sm text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200 focus:outline-none focus:ring-2 focus:ring-zinc-600 focus:ring-offset-2 focus:ring-offset-zinc-900"
          >
            <Key size={16} className="shrink-0" />
            <span className="flex-1 text-left">Use Your Own API Key</span>
            <span className="text-xs text-zinc-500">Bring your own key (BYOK)</span>
          </button>
        </div>
      </div>
    </>
  );
}
