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
      case 'starter':
        return 'bg-zinc-600';
      case 'hobbyist':
        return 'bg-blue-600';
      case 'creator':
        return 'bg-purple-600';
      case 'pro':
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
      <div className="p-4 text-center text-zinc-400">
        Loading billing information...
      </div>
    );
  }

  return (
    <div className="p-4">
      {/* Current Plan */}
      <div className="mb-6">
        <h3 className="mb-3 text-sm font-semibold text-zinc-200">
          Current Plan
        </h3>
        <div className="rounded-lg border border-zinc-700 bg-zinc-800 p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-lg font-semibold capitalize text-zinc-200">
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
            {tier === 'starter' ? (
              <button
                onClick={handleUpgrade}
                className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-500"
              >
                Upgrade Plan
              </button>
            ) : (
              <button
                onClick={handleManageSubscription}
                className="flex items-center gap-1.5 rounded border border-zinc-600 px-4 py-1.5 text-sm font-medium text-zinc-200 hover:bg-zinc-700"
              >
                Manage Subscription
                <ExternalLink size={14} />
              </button>
            )}
          </div>

          {tier !== 'starter' && billingStatus?.billingCycleStart && (
            <div className="space-y-2 text-sm text-zinc-400">
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
      {tier !== 'starter' && tokenBalance && (
        <div>
          <h3 className="mb-3 text-sm font-semibold text-zinc-200">
            Token Usage
          </h3>
          <div className="rounded-lg border border-zinc-700 bg-zinc-800 p-4">
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-zinc-400">
                  Monthly tokens:
                </span>
                <span className="font-medium text-zinc-200">
                  {tokenBalance.monthlyRemaining.toLocaleString()} /{' '}
                  {tokenBalance.monthlyTotal.toLocaleString()}
                </span>
              </div>
              {tokenBalance.addon > 0 && (
                <div className="flex justify-between">
                  <span className="text-zinc-400">
                    Add-on tokens:
                  </span>
                  <span className="font-medium text-zinc-200">
                    {tokenBalance.addon.toLocaleString()}
                  </span>
                </div>
              )}
              <div className="flex justify-between border-t border-zinc-700 pt-3">
                <span className="text-zinc-400">
                  Total available:
                </span>
                <span className="text-lg font-semibold text-zinc-200">
                  {tokenBalance.total.toLocaleString()}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Free tier message */}
      {tier === 'starter' && (
        <div className="rounded-lg border border-blue-600/30 bg-blue-600/10 p-4">
          <div className="mb-2 flex items-center gap-2 text-blue-400">
            <CreditCard size={16} />
            <span className="font-medium">Upgrade to unlock more features</span>
          </div>
          <p className="text-sm text-zinc-400">
            Get cloud saves, AI features, and more projects with a paid plan.
          </p>
        </div>
      )}
    </div>
  );
}
