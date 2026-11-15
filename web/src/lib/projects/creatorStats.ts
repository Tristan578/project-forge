/**
 * Creator analytics (#8352): one creator's published games with their play
 * counts, and their token usage this billing cycle.
 *
 * Every query is scoped by the caller's database user id, which the route
 * takes from the authenticated session and never from the request, so there is
 * no id a client could swap (no IDOR by construction).
 *
 * Plays are summed in JS over the creator's own rows: a creator has at most a
 * few hundred games in practice, and the rows are needed for the per-game table
 * anyway, so a SQL aggregate would be a second query for no gain.
 */
import { desc, eq } from 'drizzle-orm';
import { getDb, queryWithResilience } from '@/lib/db/client';
import { publishedGames, users } from '@/lib/db/schema';

export type CreatorGameStatus = 'published' | 'unpublished' | 'processing' | 'flagged';

export interface CreatorGameStat {
  id: string;
  title: string;
  slug: string;
  status: CreatorGameStatus;
  playCount: number;
  /** ISO 8601. */
  createdAt: string;
}

export interface CreatorTokenUsage {
  /** Monthly allowance used so far this billing cycle. */
  monthlyUsed: number;
  /** Monthly allowance for this billing cycle. */
  monthlyTotal: number;
  /** Purchased add-on tokens remaining. */
  addon: number;
}

export interface CreatorStats {
  /** Games currently live (`status === 'published'`). */
  totalPublishedGames: number;
  /** Plays across every game listed, live or not: past plays still happened. */
  totalPlays: number;
  /** Most-played first. */
  games: CreatorGameStat[];
  tokenUsage: CreatorTokenUsage;
}

const NO_TOKEN_USAGE: CreatorTokenUsage = { monthlyUsed: 0, monthlyTotal: 0, addon: 0 };

export async function getCreatorStats(userId: string): Promise<CreatorStats> {
  const [rows, userRows] = await Promise.all([
    queryWithResilience(() =>
      getDb()
        .select({
          id: publishedGames.id,
          title: publishedGames.title,
          slug: publishedGames.slug,
          status: publishedGames.status,
          playCount: publishedGames.playCount,
          createdAt: publishedGames.createdAt,
        })
        .from(publishedGames)
        .where(eq(publishedGames.userId, userId))
        .orderBy(desc(publishedGames.playCount), desc(publishedGames.createdAt)),
    ),
    queryWithResilience(() =>
      getDb()
        .select({
          monthlyTokens: users.monthlyTokens,
          monthlyTokensUsed: users.monthlyTokensUsed,
          addonTokens: users.addonTokens,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1),
    ),
  ]);

  const games: CreatorGameStat[] = rows.map((row) => ({
    id: row.id,
    title: row.title,
    slug: row.slug,
    status: row.status,
    playCount: row.playCount,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
  }));

  const userRow = userRows[0];
  return {
    totalPublishedGames: games.filter((g) => g.status === 'published').length,
    totalPlays: games.reduce((sum, g) => sum + g.playCount, 0),
    games,
    tokenUsage: userRow
      ? {
          monthlyUsed: userRow.monthlyTokensUsed,
          monthlyTotal: userRow.monthlyTokens,
          addon: userRow.addonTokens,
        }
      : NO_TOKEN_USAGE,
  };
}
