'use client';

/**
 * CreatorAnalyticsPanel — how a creator's published games are doing (#8352):
 * games live, total plays, token usage this cycle, and plays per game.
 *
 * Reads `/api/creator/stats`, which is scoped to the signed-in user. Loading,
 * error and empty states are explicit, and nothing renders a number before the
 * fetch has resolved (`stats` starts as null).
 */

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { Button, Card, InlineAlert, Skeleton } from '@spawnforge/ui';
import type { CreatorGameStatus, CreatorStats } from '@/lib/projects/creatorStats';

const STATUS_LABEL: Record<CreatorGameStatus, string> = {
  published: 'Live',
  unpublished: 'Unpublished',
  processing: 'Publishing',
  flagged: 'Under review',
};

const LOAD_FAILED = 'Could not load your analytics. Please try again.';
const OFFLINE = 'Unable to connect. Check your connection and try again.';

const numberFormat = new Intl.NumberFormat();

function StatTile({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <Card>
      <p className="text-sm text-[var(--sf-text-secondary)]">{label}</p>
      <p className="mt-1 text-3xl font-semibold text-[var(--sf-text)]">{value}</p>
      {detail && <p className="mt-1 text-xs text-[var(--sf-text-secondary)]">{detail}</p>}
    </Card>
  );
}

export function CreatorAnalyticsPanel() {
  const router = useRouter();
  const [stats, setStats] = useState<CreatorStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Every setState here happens after an await, so calling this from the
  // mount effect cannot cascade a synchronous second render.
  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch('/api/creator/stats');
      if (res.status === 401) {
        router.push('/sign-in');
        return;
      }
      if (!res.ok) {
        setError(LOAD_FAILED);
        return;
      }
      setStats((await res.json()) as CreatorStats);
      setError(null);
    } catch {
      setError(OFFLINE);
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void (async () => {
      await fetchStats();
    })();
  }, [fetchStats]);

  const handleRetry = () => {
    setLoading(true);
    setError(null);
    void fetchStats();
  };

  return (
    <div className="flex min-h-dvh flex-col bg-[var(--sf-bg-app)] text-[var(--sf-text)]">
      <header className="flex items-center gap-3 border-b border-[var(--sf-border)] bg-[var(--sf-bg-surface)] px-6 py-4">
        <Button variant="ghost" size="sm" onClick={() => router.push('/dashboard')}>
          <ArrowLeft size={16} aria-hidden="true" />
          Projects
        </Button>
        <h1 className="text-2xl font-bold">Creator analytics</h1>
      </header>

      <main className="flex-1 overflow-y-auto p-8" aria-busy={loading}>
        {loading && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3" data-testid="creator-analytics-loading">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} height="6rem" />
            ))}
            <span className="sr-only">Loading your analytics…</span>
          </div>
        )}

        {!loading && error && (
          <div className="mx-auto max-w-md space-y-4">
            <InlineAlert variant="error">{error}</InlineAlert>
            <Button onClick={handleRetry}>Retry</Button>
          </div>
        )}

        {!loading && !error && stats && (
          <>
            <section aria-label="Totals" className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
              <StatTile label="Games live" value={numberFormat.format(stats.totalPublishedGames)} />
              <StatTile label="Total plays" value={numberFormat.format(stats.totalPlays)} />
              <StatTile
                label="Tokens used this cycle"
                value={numberFormat.format(stats.tokenUsage.monthlyUsed)}
                detail={`of ${numberFormat.format(stats.tokenUsage.monthlyTotal)} monthly, plus ${numberFormat.format(stats.tokenUsage.addon)} add-on tokens left`}
              />
            </section>

            <section aria-labelledby="creator-games-heading">
              <h2 id="creator-games-heading" className="mb-4 text-xl font-semibold">
                Your games
              </h2>
              {stats.games.length === 0 ? (
                <p className="text-[var(--sf-text-secondary)]">
                  No published games yet. Publish a game from the editor and its plays show up here.
                </p>
              ) : (
                <div className="overflow-x-auto rounded-[var(--sf-radius-lg)] border border-[var(--sf-border)]">
                  <table className="w-full text-left text-sm">
                    <caption className="sr-only">Plays for each of your games, most played first</caption>
                    <thead className="bg-[var(--sf-bg-surface)] text-[var(--sf-text-secondary)]">
                      <tr>
                        <th scope="col" className="px-4 py-2 font-medium">Game</th>
                        <th scope="col" className="px-4 py-2 font-medium">Status</th>
                        <th scope="col" className="px-4 py-2 text-right font-medium">Plays</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.games.map((game) => (
                        <tr key={game.id} className="border-t border-[var(--sf-border)]">
                          <th scope="row" className="px-4 py-2 font-medium">{game.title}</th>
                          <td className="px-4 py-2 text-[var(--sf-text-secondary)]">{STATUS_LABEL[game.status]}</td>
                          <td className="px-4 py-2 text-right font-mono">{numberFormat.format(game.playCount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
