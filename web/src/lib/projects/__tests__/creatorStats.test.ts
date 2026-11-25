/**
 * getCreatorStats (#8352): totals over one creator's own games, and a zeroed
 * token usage when their user row is missing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { publishedGames, users } from '@/lib/db/schema';

vi.mock('server-only', () => ({}));

const hoisted = vi.hoisted(() => ({
  gameRows: [] as Array<Record<string, unknown>>,
  userRows: [] as Array<Record<string, unknown>>,
  wheres: [] as Array<{ table: unknown; where: unknown }>,
}));

/**
 * A minimal drizzle-shaped builder: `select().from(t).where(w)` then either
 * `.orderBy()` (games) or `.limit()` (user). It answers by table and records
 * every `where` so the test can prove each query is scoped to the caller.
 */
vi.mock('@/lib/db/client', async () => {
  const schema = await import('@/lib/db/schema');
  const builder = () => {
    let table: unknown;
    const rowsFor = () => (table === schema.publishedGames ? hoisted.gameRows : hoisted.userRows);
    const chain = {
      from(t: unknown) {
        table = t;
        return chain;
      },
      where(w: unknown) {
        hoisted.wheres.push({ table, where: w });
        return chain;
      },
      orderBy: () => Promise.resolve(rowsFor()),
      limit: () => Promise.resolve(rowsFor()),
    };
    return chain;
  };
  return {
    getDb: () => ({ select: () => builder() }),
    queryWithResilience: <T>(fn: () => Promise<T>) => fn(),
  };
});

import { getCreatorStats } from '../creatorStats';

const created = new Date('2026-09-01T10:00:00Z');

function game(overrides: Record<string, unknown>) {
  return { id: 'g', title: 'Game', slug: 'game', status: 'published', playCount: 0, createdAt: created, ...overrides };
}

beforeEach(() => {
  hoisted.gameRows = [];
  hoisted.userRows = [{ monthlyTokens: 1000, monthlyTokensUsed: 250, addonTokens: 40 }];
  hoisted.wheres = [];
});

describe('getCreatorStats', () => {
  it('sums plays across the creator\'s games and counts the live ones', async () => {
    hoisted.gameRows = [
      game({ id: 'a', title: 'Crystal Run', playCount: 10 }),
      game({ id: 'b', title: 'Lava Caves', playCount: 5 }),
      game({ id: 'c', title: 'Sky Hop', playCount: 0 }),
    ];

    const stats = await getCreatorStats('user-1');

    expect(stats.totalPublishedGames).toBe(3);
    expect(stats.totalPlays).toBe(15);
    expect(stats.games.map((g) => [g.title, g.playCount])).toEqual([
      ['Crystal Run', 10],
      ['Lava Caves', 5],
      ['Sky Hop', 0],
    ]);
    expect(stats.games[0]?.createdAt).toBe('2026-09-01T10:00:00.000Z');
    expect(stats.tokenUsage).toEqual({ monthlyUsed: 250, monthlyTotal: 1000, addon: 40 });
  });

  it('counts only live games as published, while past plays on hidden ones still count', async () => {
    hoisted.gameRows = [
      game({ id: 'a', status: 'published', playCount: 3 }),
      game({ id: 'b', status: 'unpublished', playCount: 7 }),
      game({ id: 'c', status: 'flagged', playCount: 2 }),
    ];

    const stats = await getCreatorStats('user-1');

    expect(stats.totalPublishedGames).toBe(1);
    expect(stats.totalPlays).toBe(12);
    expect(stats.games.map((g) => g.status)).toEqual(['published', 'unpublished', 'flagged']);
  });

  it('returns zeros and an empty list for a creator with no games', async () => {
    const stats = await getCreatorStats('user-1');

    expect(stats).toEqual({
      totalPublishedGames: 0,
      totalPlays: 0,
      games: [],
      tokenUsage: { monthlyUsed: 250, monthlyTotal: 1000, addon: 40 },
    });
  });

  it('falls back to zeroed token usage when the user row is missing', async () => {
    hoisted.userRows = [];

    const stats = await getCreatorStats('user-1');

    expect(stats.tokenUsage).toEqual({ monthlyUsed: 0, monthlyTotal: 0, addon: 0 });
  });

  // IDOR by construction: both queries filter on the id the route passes in,
  // which comes from the session. Pin the filters, not just the results.
  it('scopes both queries to the given user id', async () => {
    await getCreatorStats('user-42');

    expect(hoisted.wheres).toHaveLength(2);
    const gamesWhere = hoisted.wheres.find((w) => w.table === publishedGames)?.where;
    const userWhere = hoisted.wheres.find((w) => w.table === users)?.where;
    expect(gamesWhere).toEqual(eq(publishedGames.userId, 'user-42'));
    expect(userWhere).toEqual(eq(users.id, 'user-42'));
    expect(gamesWhere).not.toEqual(eq(publishedGames.userId, 'user-1'));
  });
});
