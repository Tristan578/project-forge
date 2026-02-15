import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { publishedGames, users, gameLikes, gameRatings, gameTags, gameComments } from '@/lib/db/schema';
import { eq, sql, and, or, ilike, desc } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const db = getDb();
    const searchParams = req.nextUrl.searchParams;
    const query = searchParams.get('q') || '';
    const sort = searchParams.get('sort') || 'trending';
    const tag = searchParams.get('tag');
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '20', 10);

    const offset = (page - 1) * limit;

    // Build base query
    const baseConditions = [
      eq(publishedGames.status, 'published'),
    ];

    // Add search filter
    if (query) {
      baseConditions.push(
        or(
          ilike(publishedGames.title, `%${query}%`),
          ilike(publishedGames.description, `%${query}%`)
        )!
      );
    }

    // Add tag filter
    if (tag) {
      const gamesWithTag = await db
        .select({ gameId: gameTags.gameId })
        .from(gameTags)
        .where(eq(gameTags.tag, tag));

      const gameIds = gamesWithTag.map((g: { gameId: string }) => g.gameId);
      if (gameIds.length > 0) {
        baseConditions.push(
          sql`${publishedGames.id} IN (${sql.join(gameIds.map((id: string) => sql`${id}`), sql`, `)})`
        );
      } else {
        // No games with this tag
        return NextResponse.json({ games: [], hasMore: false });
      }
    }

    // Fetch games with aggregated stats
    const gamesQuery = db
      .select({
        id: publishedGames.id,
        title: publishedGames.title,
        description: publishedGames.description,
        slug: publishedGames.slug,
        authorId: publishedGames.userId,
        authorName: users.displayName,
        authorEmail: users.email,
        playCount: publishedGames.playCount,
        cdnUrl: publishedGames.cdnUrl,
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
        publishedGames.createdAt,
        users.displayName,
        users.email
      );

    // Apply sorting and fetch
    let results;
    if (sort === 'trending') {
      // Trending: (likes * 3 + plays) / age_hours
      results = await gamesQuery
        .orderBy(
          desc(
            sql`(COALESCE(COUNT(DISTINCT ${gameLikes.id}), 0) * 3 + ${publishedGames.playCount}) / GREATEST(EXTRACT(EPOCH FROM (NOW() - ${publishedGames.createdAt})) / 3600, 1)`
          )
        )
        .limit(limit + 1)
        .offset(offset);
    } else if (sort === 'newest') {
      results = await gamesQuery
        .orderBy(desc(publishedGames.createdAt))
        .limit(limit + 1)
        .offset(offset);
    } else if (sort === 'top_rated') {
      results = await gamesQuery
        .orderBy(desc(sql`COALESCE(AVG(${gameRatings.rating}), 0)`))
        .limit(limit + 1)
        .offset(offset);
    } else {
      // most_played
      results = await gamesQuery
        .orderBy(desc(publishedGames.playCount))
        .limit(limit + 1)
        .offset(offset);
    }

    const hasMore = results.length > limit;
    const games = results.slice(0, limit);

    // Fetch tags for each game
    const gameIds = games.map((g: { id: string }) => g.id);
    const tagsResult = gameIds.length > 0
      ? await db
          .select({ gameId: gameTags.gameId, tag: gameTags.tag })
          .from(gameTags)
          .where(
            sql`${gameTags.gameId} IN (${sql.join(gameIds.map((id: string) => sql`${id}`), sql`, `)})`
          )
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
      authorEmail: string | null;
      playCount: number;
      cdnUrl: string | null;
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
      authorName: g.authorName || g.authorEmail?.split('@')[0] || 'Unknown',
      playCount: g.playCount,
      likeCount: Number(g.likeCount),
      avgRating: Number(g.avgRating),
      ratingCount: Number(g.ratingCount),
      commentCount: Number(g.commentCount),
      tags: tagsByGame[g.id] || [],
      thumbnail: null, // TODO: implement thumbnail support
      cdnUrl: g.cdnUrl,
      createdAt: g.createdAt.toISOString(),
    }));

    return NextResponse.json({ games: formattedGames, hasMore });
  } catch (error) {
    console.error('Failed to fetch games:', error);
    return NextResponse.json(
      { error: 'Failed to fetch games' },
      { status: 500 }
    );
  }
}
