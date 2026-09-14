// Leaderboard channel handler — submits scores to and reads top entries from
// a published game's leaderboard, backed by
// `/api/play/[userId]/[slug]/leaderboard`.
//
// The route keys off the published game's clerk `userId` + `slug`. That
// identity only exists on a published play page; the in-editor test-play
// session (the sole host of the script worker today, via `useScriptRunner`)
// has none, and MUST NOT submit test scores to a real published board. So when
// either is absent the handler rejects with a clear reason rather than posting
// to a bogus URL — the script's `catch` sees "only available when playing a
// published game", not a TypeError.

import type { AsyncHandler } from '../asyncChannelRouter';

export interface LeaderboardChannelDeps {
  fetchJson: (url: string, init?: RequestInit) => Promise<unknown>;
  /** Clerk id of the published game's owner, or null when there is no published identity. */
  userId: string | null;
  /** Published game slug, or null when there is no published identity. */
  slug: string | null;
}

interface LeaderboardEntry {
  rank: number;
  playerName: string;
  score: number;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export function createLeaderboardHandler(deps: LeaderboardChannelDeps): AsyncHandler {
  return async (method: string, args: Record<string, unknown>, _reportProgress, signal: AbortSignal) => {
    const { userId, slug } = deps;
    if (!userId || !slug) {
      throw new Error(
        'forge.leaderboard is only available when playing a published game.',
      );
    }

    const base = `/api/play/${encodeURIComponent(userId)}/${encodeURIComponent(slug)}/leaderboard`;

    switch (method) {
      case 'submit': {
        // A non-2xx response (game/board not found, rate limited, invalid
        // score) makes `fetchJson` throw, so the script's promise rejects with
        // the HTTP status rather than resolving to a misleading null.
        const result = await deps.fetchJson(base, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: args.name,
            playerName: args.playerName,
            score: args.score,
            metadata: args.metadata,
          }),
          signal,
        }) as { rank?: number };
        return typeof result.rank === 'number' ? { rank: result.rank } : null;
      }
      case 'getTop': {
        const params = new URLSearchParams();
        if (typeof args.name === 'string') params.set('name', args.name);
        if (typeof args.limit === 'number' && Number.isFinite(args.limit)) {
          params.set('limit', String(args.limit));
        }
        const qs = params.toString();
        const result = await deps.fetchJson(`${base}${qs ? `?${qs}` : ''}`, { signal }) as {
          entries?: LeaderboardEntry[];
        };
        return Array.isArray(result.entries) ? result.entries : null;
      }
      default:
        throw new Error(`Unknown leaderboard method: ${method}`);
    }
  };
}
