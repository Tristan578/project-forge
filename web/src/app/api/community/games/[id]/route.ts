import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { publishedGames, users, gameLikes, gameRatings, gameTags, gameComments } from '@/lib/db/schema';
import { eq, sql, and } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const db = getDb();
    const { id } = await params;

    // Fetch game with stats
    const gameResult = await db
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
        status: publishedGames.status,
        createdAt: publishedGames.createdAt,
        likeCount: sql<number>`COALESCE(COUNT(DISTINCT ${gameLikes.id}), 0)`,
        avgRating: sql<number>`COALESCE(AVG(${gameRatings.rating}), 0)`,
        ratingCount: sql<number>`COALESCE(COUNT(DISTINCT ${gameRatings.id}), 0)`,
      })
      .from(publishedGames)
      .leftJoin(users, eq(publishedGames.userId, users.id))
      .leftJoin(gameLikes, eq(publishedGames.id, gameLikes.gameId))
      .leftJoin(gameRatings, eq(publishedGames.id, gameRatings.gameId))
      .where(eq(publishedGames.id, id))
      .groupBy(
        publishedGames.id,
        publishedGames.title,
        publishedGames.description,
        publishedGames.slug,
        publishedGames.userId,
        publishedGames.playCount,
        publishedGames.cdnUrl,
        publishedGames.status,
        publishedGames.createdAt,
        users.displayName,
        users.email
      );

    if (gameResult.length === 0) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    const game = gameResult[0];

    // Fetch tags
    const tagsResult = await db
      .select({ tag: gameTags.tag })
      .from(gameTags)
      .where(eq(gameTags.gameId, id));

    // Fetch comments with author info
    const commentsResult = await db
      .select({
        id: gameComments.id,
        content: gameComments.content,
        parentId: gameComments.parentId,
        createdAt: gameComments.createdAt,
        authorId: gameComments.userId,
        authorName: users.displayName,
        authorEmail: users.email,
      })
      .from(gameComments)
      .leftJoin(users, eq(gameComments.userId, users.id))
      .where(and(eq(gameComments.gameId, id), eq(gameComments.flagged, 0)));

    // Fetch rating breakdown (count per star)
    const ratingBreakdown = await db
      .select({
        rating: gameRatings.rating,
        count: sql<number>`COUNT(*)`,
      })
      .from(gameRatings)
      .where(eq(gameRatings.gameId, id))
      .groupBy(gameRatings.rating);

    const breakdown = [1, 2, 3, 4, 5].map((star) => ({
      rating: star,
      count: Number(ratingBreakdown.find((r: { rating: number }) => r.rating === star)?.count || 0),
    }));

    // Format response
    const formattedGame = {
      id: game.id,
      title: game.title,
      description: game.description,
      slug: game.slug,
      authorId: game.authorId,
      authorName: game.authorName || game.authorEmail?.split('@')[0] || 'Unknown',
      playCount: game.playCount,
      likeCount: Number(game.likeCount),
      avgRating: Number(game.avgRating),
      ratingCount: Number(game.ratingCount),
      ratingBreakdown: breakdown,
      tags: tagsResult.map((t) => t.tag),
      cdnUrl: game.cdnUrl,
      status: game.status,
      createdAt: game.createdAt.toISOString(),
      comments: commentsResult.map((c: {
        id: string;
        content: string;
        parentId: string | null;
        createdAt: Date;
        authorId: string | null;
        authorName: string | null;
        authorEmail: string | null;
      }) => ({
        id: c.id,
        content: c.content,
        parentId: c.parentId,
        authorId: c.authorId,
        authorName: c.authorName || c.authorEmail?.split('@')[0] || 'Unknown',
        createdAt: c.createdAt.toISOString(),
      })),
    };

    return NextResponse.json({ game: formattedGame });
  } catch (error) {
    console.error('Failed to fetch game:', error);
    return NextResponse.json(
      { error: 'Failed to fetch game' },
      { status: 500 }
    );
  }
}
