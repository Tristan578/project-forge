'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useUserStore } from '@/stores/userStore';
import { CreditCard, ExternalLink } from 'lucide-react';

interface BillingStatus {
  tier: string;
  stripeCustomerId: string | null;
  billingCycleStart: string | null;
  nextRefillDate: string | null;
}

export function BillingTab() {
  const router = useRouter();
  const tier = useUserStore((s) => s.tier);
  const tokenBalance = useUserStore((s) => s.tokenBalance);
  const [billingStatus, setBillingStatus] = useState<BillingStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchBillingStatus();
  }, []);

  const fetchBillingStatus = async () => {
    try {
      const res = await fetch('/api/billing/status');
      if (res.ok) {
        const data = await res.json();
        setBillingStatus(data);
      }
    } catch (err) {
      console.error('Failed to fetch billing status:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleManageSubscription = async () => {
    try {
      const res = await fetch('/api/billing/portal', { method: 'POST' });
      if (res.ok) {
        const { url } = await res.json();
        window.open(url, '_blank');
      }
    } catch (err) {
      console.error('Failed to open billing portal:', err);
    }
  };

  const handleUpgrade = () => {
    router.push('/pricing');
  };

  const getTierColor = (tierName: string) => {
    switch (tierName) {
      case 'free':
        return 'bg-zinc-600';
      case 'starter':
        return 'bg-blue-600';
      case 'creator':
        return 'bg-purple-600';
      case 'studio':
        return 'bg-yellow-600';
      default:
        return 'bg-zinc-600';
    }
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  if (loading) {
    return (
      <div className="p-4 text-center text-[var(--color-text-secondary)]">
        Loading billing information...
      </div>
    );
  }

  return (
    <div className="p-4">
      {/* Current Plan */}
      <div className="mb-6">
        <h3 className="mb-3 text-sm font-semibold text-[var(--color-text-primary)]">
          Current Plan
        </h3>
        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-lg font-semibold capitalize text-[var(--color-text-primary)]">
                {tier}
              </span>
              <span
                className={`rounded px-2 py-0.5 text-xs font-medium text-white ${getTierColor(
                  tier
                )}`}
              >
                {tier.toUpperCase()}
              </span>
            </div>
            {tier === 'free' ? (
              <button
                onClick={handleUpgrade}
                className="rounded bg-[var(--color-accent)] px-4 py-1.5 text-sm font-medium text-white hover:opacity-90"
              >
                Upgrade Plan
              </button>
            ) : (
              <button
                onClick={handleManageSubscription}
                className="flex items-center gap-1.5 rounded border border-[var(--color-border)] px-4 py-1.5 text-sm font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-bg-primary)]"
              >
                Manage Subscription
                <ExternalLink size={14} />
              </button>
            )}
          </div>

          {tier !== 'free' && billingStatus?.billingCycleStart && (
            <div className="space-y-2 text-sm text-[var(--color-text-secondary)]">
              <div className="flex justify-between">
                <span>Started:</span>
                <span>{formatDate(billingStatus.billingCycleStart)}</span>
              </div>
              {billingStatus.nextRefillDate && (
                <div className="flex justify-between">
                  <span>Next renewal:</span>
                  <span>{formatDate(billingStatus.nextRefillDate)}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Token Usage */}
      {tier !== 'free' && tokenBalance && (
        <div>
          <h3 className="mb-3 text-sm font-semibold text-[var(--color-text-primary)]">
            Token Usage
          </h3>
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-tertiary)] p-4">
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-[var(--color-text-secondary)]">
                  Monthly tokens:
                </span>
                <span className="font-medium text-[var(--color-text-primary)]">
                  {tokenBalance.monthlyRemaining.toLocaleString()} /{' '}
                  {tokenBalance.monthlyTotal.toLocaleString()}
                </span>
              </div>
              {tokenBalance.addon > 0 && (
                <div className="flex justify-between">
                  <span className="text-[var(--color-text-secondary)]">
                    Add-on tokens:
                  </span>
                  <span className="font-medium text-[var(--color-text-primary)]">
                    {tokenBalance.addon.toLocaleString()}
                  </span>
                </div>
              )}
              <div className="flex justify-between border-t border-[var(--color-border)] pt-3">
                <span className="text-[var(--color-text-secondary)]">
                  Total available:
                </span>
                <span className="text-lg font-semibold text-[var(--color-text-primary)]">
                  {tokenBalance.total.toLocaleString()}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Free tier message */}
      {tier === 'free' && (
        <div className="rounded-lg border border-blue-600/30 bg-blue-600/10 p-4">
          <div className="mb-2 flex items-center gap-2 text-blue-400">
            <CreditCard size={16} />
            <span className="font-medium">Upgrade to unlock more features</span>
          </div>
          <p className="text-sm text-[var(--color-text-secondary)]">
            Get cloud saves, AI features, and more projects with a paid plan.
          </p>
        </div>
      )}
    </div>
  );
}
