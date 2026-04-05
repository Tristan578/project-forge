import { NextRequest, NextResponse } from 'next/server';
import { getDb, queryWithResilience } from '@/lib/db/client';
import { publishedGames, users, gameLikes, gameRatings, gameTags, gameComments } from '@/lib/db/schema';
import { eq, sql, and, or, ilike, desc } from 'drizzle-orm';
import { rateLimitPublicRoute } from '@/lib/rateLimit';
import { parsePaginationParams } from '@/lib/apiValidation';
import { captureException } from '@/lib/monitoring/sentry-server';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const limited = await rateLimitPublicRoute(req, 'community-games', 30, 5 * 60 * 1000);
  if (limited) return limited;

  try {
    const searchParams = req.nextUrl.searchParams;
    const query = searchParams.get('q') || '';
    const sort = searchParams.get('sort') || 'trending';
    const tag = searchParams.get('tag');
    const page = parseInt(searchParams.get('page') || '1', 10);
    const { limit } = parsePaginationParams(searchParams);

    const offset = (page - 1) * limit;

    // Build base query
    const baseConditions = [
      eq(publishedGames.status, 'published'),
    ];

    // Add search filter
    if (query) {
      const escapedQuery = query.replace(/[%_\\]/g, '\\$&');
      baseConditions.push(
        or(
          ilike(publishedGames.title, `%${escapedQuery}%`),
          ilike(publishedGames.description, `%${escapedQuery}%`)
        )!
      );
    }

    // Add tag filter
    if (tag) {
      const gamesWithTag = await queryWithResilience(() => getDb()
        .select({ gameId: gameTags.gameId })
        .from(gameTags)
        .where(eq(gameTags.tag, tag)));

      const gameIds = gamesWithTag.map((g: { gameId: string }) => g.gameId);
      if (gameIds.length > 0) {
        baseConditions.push(
          sql`${publishedGames.id} IN (${sql.join(gameIds.map((id: string) => sql`${id}`), sql`, `)})`
        );
      } else {
        // No games with this tag
        const emptyResponse = NextResponse.json({ games: [], hasMore: false });
        emptyResponse.headers.set('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
        return emptyResponse;
      }
    }

    // Fetch games with aggregated stats + apply sorting
    const results = await queryWithResilience(() => {
      const db = getDb();
      const gamesQuery = db
        .select({
          id: publishedGames.id,
          title: publishedGames.title,
          description: publishedGames.description,
          slug: publishedGames.slug,
          authorId: publishedGames.userId,
          authorName: users.displayName,
          playCount: publishedGames.playCount,
          cdnUrl: publishedGames.cdnUrl,
          thumbnail: publishedGames.thumbnail,
          createdAt: publishedGames.createdAt,
          likeCount: sql<number>`COALESCE(COUNT(DISTINCT ${gameLikes.id}), 0)`,
          avgRating: sql<number>`COALESCE(AVG(${gameRatings.rating}), 0)`,
          ratingCount: sql<number>`COALESCE(COUNT(DISTINCT ${gameRatings.id}), 0)`,
          commentCount: sql<number>`COALESCE(COUNT(DISTINCT ${gameComments.id}), 0)`,
        })
        .from(publishedGames)
        .leftJoin(users, eq(publishedGames.userId, users.id))
        .leftJoin(gameLikes, eq(publishedGames.id, gameLikes.gameId))
        .leftJoin(gameRatings, eq(publishedGames.id, gameRatings.gameId))
        .leftJoin(gameComments, eq(publishedGames.id, gameComments.gameId))
        .where(and(...baseConditions))
        .groupBy(
          publishedGames.id,
          publishedGames.title,
          publishedGames.description,
          publishedGames.slug,
          publishedGames.userId,
          publishedGames.playCount,
          publishedGames.cdnUrl,
          publishedGames.thumbnail,
          publishedGames.createdAt,
          users.displayName
        );

      if (sort === 'trending') {
        // Trending: (likes * 3 + plays) / age_hours
        return gamesQuery
          .orderBy(
            desc(
              sql`(COALESCE(COUNT(DISTINCT ${gameLikes.id}), 0) * 3 + ${publishedGames.playCount}) / GREATEST(EXTRACT(EPOCH FROM (NOW() - ${publishedGames.createdAt})) / 3600, 1)`
            )
          )
          .limit(limit + 1)
          .offset(offset);
      } else if (sort === 'newest') {
        return gamesQuery
          .orderBy(desc(publishedGames.createdAt))
          .limit(limit + 1)
          .offset(offset);
      } else if (sort === 'top_rated') {
        return gamesQuery
          .orderBy(desc(sql`COALESCE(AVG(${gameRatings.rating}), 0)`))
          .limit(limit + 1)
          .offset(offset);
      } else {
        // most_played
        return gamesQuery
          .orderBy(desc(publishedGames.playCount))
          .limit(limit + 1)
          .offset(offset);
      }
    });

    const hasMore = results.length > limit;
    const games = results.slice(0, limit);

    // Fetch tags for each game
    const gameIds = games.map((g: { id: string }) => g.id);
    const tagsResult = gameIds.length > 0
      ? await queryWithResilience(() => getDb()
          .select({ gameId: gameTags.gameId, tag: gameTags.tag })
          .from(gameTags)
          .where(
            sql`${gameTags.gameId} IN (${sql.join(gameIds.map((id: string) => sql`${id}`), sql`, `)})`
          ))
      : [];

    const tagsByGame: Record<string, string[]> = {};
    for (const t of tagsResult) {
      if (!tagsByGame[t.gameId]) tagsByGame[t.gameId] = [];
      tagsByGame[t.gameId].push(t.tag);
    }

    // Format response
    const formattedGames = games.map((g: {
      id: string;
      title: string;
      description: string | null;
      slug: string;
      authorId: string;
      authorName: string | null;
      playCount: number;
      cdnUrl: string | null;
      thumbnail: string | null;
      createdAt: Date;
      likeCount: number;
      avgRating: number;
      ratingCount: number;
      commentCount: number;
    }) => ({
      id: g.id,
      title: g.title,
      description: g.description,
      slug: g.slug,
      authorId: g.authorId,
      authorName: g.authorName || 'Unknown',
      playCount: g.playCount,
      likeCount: Number(g.likeCount),
      avgRating: Number(g.avgRating),
      ratingCount: Number(g.ratingCount),
      commentCount: Number(g.commentCount),
      tags: tagsByGame[g.id] || [],
      thumbnail: g.thumbnail,
      cdnUrl: g.cdnUrl,
      createdAt: g.createdAt.toISOString(),
    }));

    const response = NextResponse.json({ games: formattedGames, hasMore });
    response.headers.set('Cache-Control', 'public, max-age=60, s-maxage=300');
    return response;
  } catch (error) {
    captureException(error, { route: '/api/community/games' });
    return NextResponse.json(
      { error: 'Failed to fetch games' },
      { status: 500 }
    );
  }
}
