'use client';

import { useEffect, useState } from 'react';
import { useUserStore } from '@/stores/userStore';
import { Coins, TrendingUp, ShoppingCart } from 'lucide-react';
import { TOKEN_PACKAGES } from '@/lib/tokens/pricing';

interface UsageEntry {
  operation: string;
  tokens: number;
  provider: string | null;
  createdAt: string;
}

export function TokenDashboard() {
  const { tokenBalance, tier, fetchBalance } = useUserStore();
  const [usage, setUsage] = useState<UsageEntry[]>([]);
  const [purchasing, setPurchasing] = useState(false);

  useEffect(() => {
    fetchBalance();
    fetch('/api/tokens/usage?days=30')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('Failed'))))
      .then((data) => setUsage(data.usage ?? []))
      .catch(() => {});
  }, [fetchBalance]);

  const handlePurchase = async (pkg: string) => {
    setPurchasing(true);
    try {
      const res = await fetch('/api/tokens/purchase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ package: pkg }),
      });
      const data = await res.json();
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
      }
    } catch (err) {
      console.error('Purchase failed:', err);
    } finally {
      setPurchasing(false);
    }
  };

  // Group usage by operation type
  const usageByOp: Record<string, number> = {};
  for (const entry of usage) {
    if (entry.tokens > 0) {
      usageByOp[entry.operation] = (usageByOp[entry.operation] ?? 0) + entry.tokens;
    }
  }

  return (
    <div className="space-y-6 p-4">
      {/* Balance Card */}
      <div className="rounded-lg bg-zinc-800 p-4">
        <div className="mb-2 flex items-center gap-2">
          <Coins size={18} className="text-yellow-400" />
          <h3 className="font-semibold text-zinc-200">Token Balance</h3>
        </div>
        {tokenBalance ? (
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <div className="text-2xl font-bold text-zinc-200">
                {tokenBalance.total.toLocaleString()}
              </div>
              <div className="text-xs text-zinc-400">Total Available</div>
            </div>
            <div>
              <div className="text-lg font-medium text-zinc-200">
                {tokenBalance.monthlyRemaining.toLocaleString()}
              </div>
              <div className="text-xs text-zinc-400">Monthly Remaining</div>
            </div>
            <div>
              <div className="text-lg font-medium text-zinc-200">
                {tokenBalance.addon.toLocaleString()}
              </div>
              <div className="text-xs text-zinc-400">Add-On</div>
            </div>
          </div>
        ) : (
          <div className="text-sm text-zinc-400">Loading...</div>
        )}
        {tokenBalance?.nextRefillDate && (
          <div className="mt-2 text-xs text-zinc-400">
            Next refill: {new Date(tokenBalance.nextRefillDate).toLocaleDateString()}
          </div>
        )}
      </div>

      {/* Usage Breakdown */}
      {Object.keys(usageByOp).length > 0 && (
        <div className="rounded-lg bg-zinc-800 p-4">
          <div className="mb-2 flex items-center gap-2">
            <TrendingUp size={18} className="text-blue-400" />
            <h3 className="font-semibold text-zinc-200">
              Usage (Last 30 Days)
            </h3>
          </div>
          <div className="space-y-1">
            {Object.entries(usageByOp)
              .sort(([, a], [, b]) => b - a)
              .map(([op, tokens]) => (
                <div
                  key={op}
                  className="flex items-center justify-between text-sm text-zinc-400"
                >
                  <span>{op.replace(/_/g, ' ')}</span>
                  <span className="font-mono">{tokens.toLocaleString()}</span>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Buy Tokens */}
      {tier !== 'starter' && (
        <div className="rounded-lg bg-zinc-800 p-4">
          <div className="mb-3 flex items-center gap-2">
            <ShoppingCart size={18} className="text-green-400" />
            <h3 className="font-semibold text-zinc-200">Buy More Tokens</h3>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {(Object.entries(TOKEN_PACKAGES) as [string, { tokens: number; priceCents: number; label: string }][]).map(
              ([key, pkg]) => (
                <button
                  key={key}
                  onClick={() => handlePurchase(key)}
                  disabled={purchasing}
                  className="rounded-md border border-zinc-600 p-3 text-center transition-colors hover:border-blue-500 hover:bg-zinc-900 disabled:opacity-50"
                >
                  <div className="font-semibold text-zinc-200">{pkg.label}</div>
                  <div className="text-lg font-bold text-yellow-400">
                    {pkg.tokens.toLocaleString()}
                  </div>
                  <div className="text-xs text-zinc-400">
                    ${(pkg.priceCents / 100).toFixed(0)}
                  </div>
                </button>
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
}
