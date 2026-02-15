import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { publishedGames, users, gameLikes, gameRatings, gameTags, gameComments, featuredGames } from '@/lib/db/schema';
import { eq, sql, and, gt } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = getDb();

    // Get featured game IDs
    const featured = await db
      .select({ gameId: featuredGames.gameId })
      .from(featuredGames)
      .where(
        and(
          gt(featuredGames.expiresAt, new Date()),
          eq(publishedGames.status, 'published')
        )
      )
      .leftJoin(publishedGames, eq(featuredGames.gameId, publishedGames.id))
      .orderBy(featuredGames.position)
      .limit(5);

    if (featured.length === 0) {
      return NextResponse.json({ games: [] });
    }

    const gameIds = featured.map((f: { gameId: string }) => f.gameId);

    // Fetch full game details with stats
    const games = await db
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
      .where(
        sql`${publishedGames.id} IN (${sql.join(gameIds.map((id: string) => sql`${id}`), sql`, `)})`
      )
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

    // Fetch tags for each game
    const tagsResult = await db
      .select({ gameId: gameTags.gameId, tag: gameTags.tag })
      .from(gameTags)
      .where(
        sql`${gameTags.gameId} IN (${sql.join(gameIds.map((id: string) => sql`${id}`), sql`, `)})`
      );

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
      thumbnail: null,
      cdnUrl: g.cdnUrl,
      createdAt: g.createdAt.toISOString(),
    }));

    return NextResponse.json({ games: formattedGames });
  } catch (error) {
    console.error('Failed to fetch featured games:', error);
    return NextResponse.json(
      { error: 'Failed to fetch featured games' },
      { status: 500 }
    );
  }
}
