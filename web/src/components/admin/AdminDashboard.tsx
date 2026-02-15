'use client';

import { useEffect, useState, useCallback } from 'react';
import type { TokenConfig, TierConfig, CreditTransaction } from '@/lib/db/schema';

interface UserStats {
  totalUsers: number;
  starterCount: number;
  hobbyistCount: number;
  creatorCount: number;
  proCount: number;
}

interface CostSummaryRow {
  actionType: string;
  provider: string | null;
  totalCost: string | null;
  totalTokens: string | null;
  count: number;
}

interface DashboardData {
  userStats: UserStats;
  costSummary: CostSummaryRow[];
  recentTransactions: CreditTransaction[];
  tokenConfigs: TokenConfig[];
  tierConfigs: TierConfig[];
}

export function AdminDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/economics');
      if (!res.ok) {
        throw new Error(`Failed to fetch: ${res.status}`);
      }
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const saveTokenConfig = useCallback(async (config: TokenConfig) => {
    setSaving(config.id);
    try {
      const res = await fetch('/api/admin/economics/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'token_config',
          id: config.id,
          tokenCost: config.tokenCost,
          estimatedCostCents: config.estimatedCostCents,
          active: config.active,
        }),
      });
      if (!res.ok) {
        throw new Error(`Save failed: ${res.status}`);
      }
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(null);
    }
  }, [fetchData]);

  const saveTierConfig = useCallback(async (config: TierConfig) => {
    setSaving(config.id);
    try {
      const res = await fetch('/api/admin/economics/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'tier_config',
          id: config.id,
          monthlyTokens: config.monthlyTokens,
          maxProjects: config.maxProjects,
          maxPublished: config.maxPublished,
          priceCentsMonthly: config.priceCentsMonthly,
        }),
      });
      if (!res.ok) {
        throw new Error(`Save failed: ${res.status}`);
      }
      await fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(null);
    }
  }, [fetchData]);

  const updateTokenConfig = useCallback((id: string, field: keyof TokenConfig, value: number | boolean) => {
    if (!data) return;
    setData({
      ...data,
      tokenConfigs: data.tokenConfigs.map((c) =>
        c.id === id ? { ...c, [field]: value } : c
      ),
    });
  }, [data]);

  const updateTierConfig = useCallback((id: string, field: keyof TierConfig, value: number) => {
    if (!data) return;
    setData({
      ...data,
      tierConfigs: data.tierConfigs.map((c) =>
        c.id === id ? { ...c, [field]: value } : c
      ),
    });
  }, [data]);

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-900 text-zinc-300 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500 mb-4"></div>
          <p>Loading dashboard...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-zinc-900 text-zinc-300 flex items-center justify-center">
        <div className="bg-red-900/20 border border-red-500 rounded-lg p-6 max-w-md">
          <h2 className="text-xl font-bold text-red-400 mb-2">Error</h2>
          <p>{error || 'Failed to load data'}</p>
          <button
            onClick={fetchData}
            className="mt-4 bg-blue-600 hover:bg-blue-500 text-white rounded px-4 py-2 text-sm"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-900 text-zinc-300 p-8">
      <div className="max-w-7xl mx-auto space-y-8">
        <h1 className="text-3xl font-bold text-white">Admin Economics Dashboard</h1>

        {/* User Stats */}
        <div className="bg-zinc-800 rounded-lg p-6">
          <h2 className="text-xl font-semibold mb-4 text-white">User Statistics</h2>
          <div className="grid grid-cols-5 gap-4 text-center">
            <div>
              <div className="text-3xl font-bold text-blue-400">{data.userStats.totalUsers}</div>
              <div className="text-sm text-zinc-400">Total Users</div>
            </div>
            <div>
              <div className="text-3xl font-bold text-green-400">{data.userStats.starterCount}</div>
              <div className="text-sm text-zinc-400">Starter</div>
            </div>
            <div>
              <div className="text-3xl font-bold text-yellow-400">{data.userStats.hobbyistCount}</div>
              <div className="text-sm text-zinc-400">Hobbyist</div>
            </div>
            <div>
              <div className="text-3xl font-bold text-orange-400">{data.userStats.creatorCount}</div>
              <div className="text-sm text-zinc-400">Creator</div>
            </div>
            <div>
              <div className="text-3xl font-bold text-purple-400">{data.userStats.proCount}</div>
              <div className="text-sm text-zinc-400">Pro</div>
            </div>
          </div>
        </div>

        {/* Cost Summary */}
        <div className="bg-zinc-800 rounded-lg p-6">
          <h2 className="text-xl font-semibold mb-4 text-white">Cost by Action (Last 30 Days)</h2>
          <div className="overflow-x-auto">
            <table className="w-full border border-zinc-700">
              <thead className="bg-zinc-800">
                <tr>
                  <th className="px-4 py-2 text-left border-b border-zinc-700">Action Type</th>
                  <th className="px-4 py-2 text-left border-b border-zinc-700">Provider</th>
                  <th className="px-4 py-2 text-right border-b border-zinc-700">Cost ($)</th>
                  <th className="px-4 py-2 text-right border-b border-zinc-700">Tokens</th>
                  <th className="px-4 py-2 text-right border-b border-zinc-700">Count</th>
                </tr>
              </thead>
              <tbody>
                {data.costSummary.map((row, i) => (
                  <tr key={i} className="hover:bg-zinc-800/50">
                    <td className="px-4 py-2 border-b border-zinc-700">{row.actionType}</td>
                    <td className="px-4 py-2 border-b border-zinc-700">{row.provider || '-'}</td>
                    <td className="px-4 py-2 text-right border-b border-zinc-700">
                      {row.totalCost ? `$${(Number(row.totalCost) / 100).toFixed(2)}` : '-'}
                    </td>
                    <td className="px-4 py-2 text-right border-b border-zinc-700">
                      {row.totalTokens || '0'}
                    </td>
                    <td className="px-4 py-2 text-right border-b border-zinc-700">{row.count}</td>
                  </tr>
                ))}
                {data.costSummary.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-zinc-500">
                      No cost data in the last 30 days
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Token Pricing Config */}
        <div className="bg-zinc-800 rounded-lg p-6">
          <h2 className="text-xl font-semibold mb-4 text-white">Token Pricing Config</h2>
          <div className="overflow-x-auto">
            <table className="w-full border border-zinc-700">
              <thead className="bg-zinc-800">
                <tr>
                  <th className="px-4 py-2 text-left border-b border-zinc-700">Action Type</th>
                  <th className="px-4 py-2 text-left border-b border-zinc-700">Provider</th>
                  <th className="px-4 py-2 text-center border-b border-zinc-700">Token Cost</th>
                  <th className="px-4 py-2 text-center border-b border-zinc-700">Est. Cost ($)</th>
                  <th className="px-4 py-2 text-center border-b border-zinc-700">Active</th>
                  <th className="px-4 py-2 text-center border-b border-zinc-700">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.tokenConfigs.map((config) => (
                  <tr key={config.id} className="hover:bg-zinc-800/50">
                    <td className="px-4 py-2 border-b border-zinc-700">{config.actionType}</td>
                    <td className="px-4 py-2 border-b border-zinc-700">{config.provider || '-'}</td>
                    <td className="px-4 py-2 text-center border-b border-zinc-700">
                      <input
                        type="number"
                        value={config.tokenCost}
                        onChange={(e) => updateTokenConfig(config.id, 'tokenCost', parseInt(e.target.value) || 0)}
                        className="bg-zinc-800 border border-zinc-700 text-zinc-300 rounded px-2 py-1 text-sm w-20 text-center"
                      />
                    </td>
                    <td className="px-4 py-2 text-center border-b border-zinc-700">
                      <input
                        type="number"
                        value={config.estimatedCostCents || 0}
                        onChange={(e) => updateTokenConfig(config.id, 'estimatedCostCents', parseInt(e.target.value) || 0)}
                        className="bg-zinc-800 border border-zinc-700 text-zinc-300 rounded px-2 py-1 text-sm w-20 text-center"
                      />
                    </td>
                    <td className="px-4 py-2 text-center border-b border-zinc-700">
                      <input
                        type="checkbox"
                        checked={config.active === 1}
                        onChange={(e) => updateTokenConfig(config.id, 'active', e.target.checked ? 1 : 0)}
                        className="w-4 h-4"
                      />
                    </td>
                    <td className="px-4 py-2 text-center border-b border-zinc-700">
                      <button
                        onClick={() => saveTokenConfig(config)}
                        disabled={saving === config.id}
                        className="bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white rounded px-3 py-1 text-sm"
                      >
                        {saving === config.id ? 'Saving...' : 'Save'}
                      </button>
                    </td>
                  </tr>
                ))}
                {data.tokenConfigs.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-zinc-500">
                      No token configs found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Tier Config */}
        <div className="bg-zinc-800 rounded-lg p-6">
          <h2 className="text-xl font-semibold mb-4 text-white">Tier Config</h2>
          <div className="overflow-x-auto">
            <table className="w-full border border-zinc-700">
              <thead className="bg-zinc-800">
                <tr>
                  <th className="px-4 py-2 text-left border-b border-zinc-700">Tier</th>
                  <th className="px-4 py-2 text-center border-b border-zinc-700">Monthly Tokens</th>
                  <th className="px-4 py-2 text-center border-b border-zinc-700">Max Projects</th>
                  <th className="px-4 py-2 text-center border-b border-zinc-700">Max Published</th>
                  <th className="px-4 py-2 text-center border-b border-zinc-700">Price ($/mo)</th>
                  <th className="px-4 py-2 text-center border-b border-zinc-700">Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.tierConfigs.map((config) => (
                  <tr key={config.id} className="hover:bg-zinc-800/50">
                    <td className="px-4 py-2 border-b border-zinc-700 font-semibold">{config.tierId}</td>
                    <td className="px-4 py-2 text-center border-b border-zinc-700">
                      <input
                        type="number"
                        value={config.monthlyTokens}
                        onChange={(e) => updateTierConfig(config.id, 'monthlyTokens', parseInt(e.target.value) || 0)}
                        className="bg-zinc-800 border border-zinc-700 text-zinc-300 rounded px-2 py-1 text-sm w-24 text-center"
                      />
                    </td>
                    <td className="px-4 py-2 text-center border-b border-zinc-700">
                      <input
                        type="number"
                        value={config.maxProjects}
                        onChange={(e) => updateTierConfig(config.id, 'maxProjects', parseInt(e.target.value) || 0)}
                        className="bg-zinc-800 border border-zinc-700 text-zinc-300 rounded px-2 py-1 text-sm w-20 text-center"
                      />
                    </td>
                    <td className="px-4 py-2 text-center border-b border-zinc-700">
                      <input
                        type="number"
                        value={config.maxPublished}
                        onChange={(e) => updateTierConfig(config.id, 'maxPublished', parseInt(e.target.value) || 0)}
                        className="bg-zinc-800 border border-zinc-700 text-zinc-300 rounded px-2 py-1 text-sm w-20 text-center"
                      />
                    </td>
                    <td className="px-4 py-2 text-center border-b border-zinc-700">
                      <input
                        type="number"
                        value={config.priceCentsMonthly}
                        onChange={(e) => updateTierConfig(config.id, 'priceCentsMonthly', parseInt(e.target.value) || 0)}
                        className="bg-zinc-800 border border-zinc-700 text-zinc-300 rounded px-2 py-1 text-sm w-24 text-center"
                      />
                    </td>
                    <td className="px-4 py-2 text-center border-b border-zinc-700">
                      <button
                        onClick={() => saveTierConfig(config)}
                        disabled={saving === config.id}
                        className="bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white rounded px-3 py-1 text-sm"
                      >
                        {saving === config.id ? 'Saving...' : 'Save'}
                      </button>
                    </td>
                  </tr>
                ))}
                {data.tierConfigs.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-zinc-500">
                      No tier configs found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Recent Transactions */}
        <div className="bg-zinc-800 rounded-lg p-6">
          <h2 className="text-xl font-semibold mb-4 text-white">Recent Transactions</h2>
          <div className="overflow-x-auto">
            <table className="w-full border border-zinc-700">
              <thead className="bg-zinc-800">
                <tr>
                  <th className="px-4 py-2 text-left border-b border-zinc-700">Time</th>
                  <th className="px-4 py-2 text-left border-b border-zinc-700">Type</th>
                  <th className="px-4 py-2 text-right border-b border-zinc-700">Amount</th>
                  <th className="px-4 py-2 text-right border-b border-zinc-700">Balance After</th>
                  <th className="px-4 py-2 text-left border-b border-zinc-700">Source</th>
                </tr>
              </thead>
              <tbody>
                {data.recentTransactions.map((txn) => (
                  <tr key={txn.id} className="hover:bg-zinc-800/50">
                    <td className="px-4 py-2 border-b border-zinc-700">
                      {formatRelativeTime(txn.createdAt)}
                    </td>
                    <td className="px-4 py-2 border-b border-zinc-700">{txn.transactionType}</td>
                    <td className={`px-4 py-2 text-right border-b border-zinc-700 ${txn.amount >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {txn.amount >= 0 ? '+' : ''}{txn.amount}
                    </td>
                    <td className="px-4 py-2 text-right border-b border-zinc-700">{txn.balanceAfter}</td>
                    <td className="px-4 py-2 border-b border-zinc-700">{txn.source || '-'}</td>
                  </tr>
                ))}
                {data.recentTransactions.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-zinc-500">
                      No recent transactions
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function formatRelativeTime(date: Date | string): string {
  const now = new Date();
  const then = new Date(date);
  const diffMs = now.getTime() - then.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay < 30) return `${diffDay}d ago`;
  return then.toLocaleDateString();
}
