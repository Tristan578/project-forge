'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { X, AlertTriangle, CreditCard } from 'lucide-react';
import { useUserStore } from '@/stores/userStore';
import { SETTINGS_BILLING_HREF, SETTINGS_TOKENS_HREF } from '@/lib/navigation/settingsRoutes';

const DISMISSED_KEY = 'forge-token-warning-dismissed';
const PAYMENT_DISMISSED_KEY = 'forge-payment-warning-dismissed';

/**
 * Shows a warning banner when:
 * 1. Token balance drops below 10% of monthly allocation
 * 2. Subscription is in past_due status (payment recovery)
 */
export function TokenWarningBanner() {
  const tokenBalance = useUserStore((s) => s.tokenBalance);
  const billingStatus = useUserStore((s) => s.billingStatus);

  const [tokenDismissed, setTokenDismissed] = useState(() => {
    try {
      return !!localStorage.getItem(DISMISSED_KEY);
    } catch {
      return false;
    }
  });

  const [paymentDismissed, setPaymentDismissed] = useState(() => {
    try {
      return !!localStorage.getItem(PAYMENT_DISMISSED_KEY);
    } catch {
      return false;
    }
  });

  const isTokenLow = useMemo(() => {
    if (!tokenBalance) return false;
    if (tokenBalance.monthlyTotal <= 0) return false;
    return tokenBalance.monthlyRemaining / tokenBalance.monthlyTotal < 0.2;
  }, [tokenBalance]);

  const isPastDue = billingStatus?.subscriptionStatus === 'past_due';

  const handleDismissToken = () => {
    setTokenDismissed(true);
    try {
      localStorage.setItem(DISMISSED_KEY, '1');
    } catch {
      // localStorage unavailable
    }
  };

  const handleDismissPayment = () => {
    setPaymentDismissed(true);
    try {
      localStorage.setItem(PAYMENT_DISMISSED_KEY, '1');
    } catch {
      // localStorage unavailable
    }
  };

  return (
    <>
      {isPastDue && !paymentDismissed && (
        <div
          role="alert"
          data-testid="payment-warning-banner"
          className="flex items-center gap-2 border-b border-red-700/50 bg-red-900/80 px-3 py-1.5 text-xs text-red-200"
        >
          <CreditCard size={14} className="shrink-0 text-red-400" />
          <span className="flex-1">
            Your payment method has failed. Please update it to avoid service interruption.
          </span>
          <a
            href={SETTINGS_BILLING_HREF}
            className="shrink-0 rounded bg-red-700 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-red-600"
          >
            Update Payment
          </a>
          <button
            onClick={handleDismissPayment}
            className="shrink-0 rounded p-0.5 hover:bg-red-800"
            aria-label="Dismiss payment warning"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {isTokenLow && !tokenDismissed && (
        <div
          role="alert"
          data-testid="token-warning-banner"
          className="flex items-center gap-2 border-b border-amber-700/50 bg-amber-900/80 px-3 py-1.5 text-xs text-amber-200"
        >
          <AlertTriangle size={14} className="shrink-0 text-amber-400" />
          <span className="flex-1">
            Your AI token balance is below 20%.{' '}
            {tokenBalance && (
              <span className="font-medium">
                {tokenBalance.monthlyRemaining.toLocaleString()} of{' '}
                {tokenBalance.monthlyTotal.toLocaleString()} remaining.
              </span>
            )}
          </span>
          {/* A client-side Link, not <a>: a full page load would throw away
              the editor's in-memory state, including a plan waiting to be
              built. Theme tokens and a 24px target (WCAG 2.5.8). */}
          <Link
            href={SETTINGS_TOKENS_HREF}
            className="inline-flex min-h-6 shrink-0 items-center rounded bg-[var(--sf-bg-elevated)] px-2 text-xs font-medium text-[var(--sf-text)] hover:bg-[var(--sf-bg-overlay)]"
          >
            Buy Tokens
          </Link>
          <button
            onClick={handleDismissToken}
            className="shrink-0 rounded p-0.5 hover:bg-amber-800"
            aria-label="Dismiss token warning"
          >
            <X size={14} />
          </button>
        </div>
      )}
    </>
  );
}
