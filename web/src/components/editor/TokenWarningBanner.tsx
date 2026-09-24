'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { X, AlertTriangle, CreditCard } from 'lucide-react';
import { useUserStore } from '@/stores/userStore';
import { SETTINGS_BILLING_HREF, SETTINGS_TOKENS_HREF } from '@/lib/navigation/settingsRoutes';

const DISMISSED_KEY = 'forge-token-warning-dismissed';

/**
 * Both banners' action link and dismiss control. Links are client-side
 * `next/link`, never `<a>`: a full page load would throw away the editor's
 * in-memory state, including a plan waiting to be built. Targets are 44px on
 * mobile (the library Button's own minimum) and 24px from `sm` up (WCAG 2.5.8).
 */
const ACTION_CLASSES =
  'inline-flex min-h-11 shrink-0 items-center rounded bg-[var(--sf-bg-elevated)] px-2 text-xs font-medium text-[var(--sf-text)] hover:bg-[var(--sf-bg-overlay)] sm:min-h-6';
const DISMISS_CLASSES =
  'inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded text-[var(--sf-text)] hover:bg-[var(--sf-bg-overlay)] sm:min-h-6 sm:min-w-6';
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
          className="flex items-center gap-2 border-b border-[var(--sf-destructive)] bg-[color-mix(in_srgb,var(--sf-destructive)_12%,var(--sf-bg-surface))] px-3 py-1.5 text-xs text-[var(--sf-text)]"
        >
          <CreditCard size={14} className="shrink-0 text-[var(--sf-destructive)]" aria-hidden="true" />
          <span className="flex-1">
            Your payment method has failed. Please update it to avoid service interruption.
          </span>
          <Link href={SETTINGS_BILLING_HREF} className={ACTION_CLASSES}>
            Update Payment
          </Link>
          <button
            type="button"
            onClick={handleDismissPayment}
            className={DISMISS_CLASSES}
            aria-label="Dismiss payment warning"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      )}

      {isTokenLow && !tokenDismissed && (
        <div
          role="alert"
          data-testid="token-warning-banner"
          className="flex items-center gap-2 border-b border-[var(--sf-warning)] bg-[color-mix(in_srgb,var(--sf-warning)_12%,var(--sf-bg-surface))] px-3 py-1.5 text-xs text-[var(--sf-text)]"
        >
          <AlertTriangle size={14} className="shrink-0 text-[var(--sf-warning)]" aria-hidden="true" />
          <span className="flex-1">
            Your AI token balance is below 20%.{' '}
            {tokenBalance && (
              <span className="font-medium">
                {tokenBalance.monthlyRemaining.toLocaleString()} of{' '}
                {tokenBalance.monthlyTotal.toLocaleString()} remaining.
              </span>
            )}
          </span>
          <Link href={SETTINGS_TOKENS_HREF} className={ACTION_CLASSES}>
            Buy Tokens
          </Link>
          <button
            type="button"
            onClick={handleDismissToken}
            className={DISMISS_CLASSES}
            aria-label="Dismiss token warning"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      )}
    </>
  );
}
