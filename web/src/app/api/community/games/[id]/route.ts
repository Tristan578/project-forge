import { NextRequest, NextResponse } from 'next/server';
import { getDb, queryWithResilience } from '@/lib/db/client';
import { publishedGames, users, gameLikes, gameRatings, gameTags, gameComments, gameForks } from '@/lib/db/schema';
import { eq, sql, and } from 'drizzle-orm';
import { rateLimitPublicRoute } from '@/lib/rateLimit';
import { captureException } from '@/lib/monitoring/sentry-server';
import { redactedJson } from '@/lib/api/errors';
import { withEgressGuard } from '@/lib/security/egressGuard';

export const dynamic = 'force-dynamic';

async function GET_impl(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const limited = await rateLimitPublicRoute(req, 'community-game', 30, 60_000);
  if (limited) return limited;
  try {
    const { id } = await params;

    // Fetch game with stats
    const gameResult = await queryWithResilience(() => getDb()
      .select({
        id: publishedGames.id,
        title: publishedGames.title,
        description: publishedGames.description,
        slug: publishedGames.slug,
        projectId: publishedGames.projectId,
        authorId: publishedGames.userId,
        authorName: users.displayName,
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
      // Only published games are publicly visible. Mirrors the list route's
      // `status = 'published'` filter so processing/unpublished/removed games
      // are not leaked via the detail endpoint (404, not their existence).
      .where(and(eq(publishedGames.id, id), eq(publishedGames.status, 'published')))
      .groupBy(
        publishedGames.id,
        publishedGames.title,
        publishedGames.description,
        publishedGames.slug,
        publishedGames.projectId,
        publishedGames.userId,
        publishedGames.playCount,
        publishedGames.cdnUrl,
        publishedGames.status,
        publishedGames.createdAt,
        users.displayName
      ));

    if (gameResult.length === 0) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    const game = gameResult[0];

    // Fetch tags
    const tagsResult = await queryWithResilience(() => getDb()
      .select({ tag: gameTags.tag })
      .from(gameTags)
      .where(eq(gameTags.gameId, id)));

    // Fetch comments with author info
    const commentsResult = await queryWithResilience(() => getDb()
      .select({
        id: gameComments.id,
        content: gameComments.content,
        parentId: gameComments.parentId,
        createdAt: gameComments.createdAt,
        authorId: gameComments.userId,
        authorName: users.displayName,
      })
      .from(gameComments)
      .leftJoin(users, eq(gameComments.userId, users.id))
      .where(and(eq(gameComments.gameId, id), eq(gameComments.flagged, 0))));

    // Fetch rating breakdown (count per star)
    const ratingBreakdown = await queryWithResilience(() => getDb()
      .select({
        rating: gameRatings.rating,
        count: sql<number>`COUNT(*)`,
      })
      .from(gameRatings)
      .where(eq(gameRatings.gameId, id))
      .groupBy(gameRatings.rating));

    const breakdown = [1, 2, 3, 4, 5].map((star) => ({
      rating: star,
      count: Number(ratingBreakdown.find((r: { rating: number }) => r.rating === star)?.count ?? 0),
    }));

    // Fork attribution (#7858). Two separate indexed lookups, NOT joins on the
    // aggregate query above: game_forks has no relation to gameLikes /
    // gameRatings, and joining it there would multiply those COUNT/AVG rows.
    //
    // How many times THIS game has been forked (idx_game_forks_original).
    const [forkCountRow] = await queryWithResilience(() => getDb()
      .select({ count: sql<number>`COUNT(*)` })
      .from(gameForks)
      .where(eq(gameForks.originalGameId, id)));
    const forkCount = Number(forkCountRow?.count ?? 0);

    // Was THIS game's project itself created by a fork? Each fork creates a
    // fresh project row, so forkedProjectId is effectively unique
    // (idx_game_forks_forked_project). The original's status is fetched, not
    // filtered in SQL, so the gate below can tell "never forked" from
    // "forked, but the source is no longer public".
    const [forkedFromRow] = await queryWithResilience(() => getDb()
      .select({
        originalGameId: gameForks.originalGameId,
        originalTitle: publishedGames.title,
        originalSlug: publishedGames.slug,
        originalAuthorClerkId: users.clerkId,
        originalAuthorName: users.displayName,
        originalStatus: publishedGames.status,
      })
      .from(gameForks)
      .innerJoin(publishedGames, eq(gameForks.originalGameId, publishedGames.id))
      .leftJoin(users, eq(publishedGames.userId, users.id))
      .where(eq(gameForks.forkedProjectId, game.projectId))
      .limit(1));

    // HARD visibility gate, same rule the main query enforces: unpublish is a
    // soft delete (status = 'unpublished', row kept), so without this a fork
    // would keep leaking the title, slug, Clerk id and author of a game its
    // creator took down or moderation removed. `authorClerkId` is not a new
    // exposure when the original IS public — it is the [userId] segment of
    // that game's own /play URL.
    const forkedFrom =
      forkedFromRow && forkedFromRow.originalStatus === 'published'
        ? {
            gameId: forkedFromRow.originalGameId,
            title: forkedFromRow.originalTitle,
            slug: forkedFromRow.originalSlug,
            authorClerkId: forkedFromRow.originalAuthorClerkId,
            authorName: forkedFromRow.originalAuthorName ?? 'Unknown creator',
          }
        : forkedFromRow
          ? { gameId: null, title: null, slug: null, authorClerkId: null, authorName: null, unavailable: true as const }
          : null;

    // Format response
    const formattedGame = {
      id: game.id,
      title: game.title,
      description: game.description,
      slug: game.slug,
      authorId: game.authorId,
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- a blank stored authorName is unset, same as absent; falls back to a display placeholder
      authorName: game.authorName || 'Unknown',
      playCount: game.playCount,
      likeCount: Number(game.likeCount),
      avgRating: Number(game.avgRating),
      ratingCount: Number(game.ratingCount),
      ratingBreakdown: breakdown,
      tags: tagsResult.map((t) => t.tag),
      forkCount,
      forkedFrom,
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
      }) => ({
        id: c.id,
        content: c.content,
        parentId: c.parentId,
        authorId: c.authorId,
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- a blank stored authorName is unset, same as absent; falls back to a display placeholder
        authorName: c.authorName || 'Unknown',
        createdAt: c.createdAt.toISOString(),
      })),
    };

    // Explicit no-store: this endpoint returns user comments which may be
    // moderated/flagged. Caching would keep flagged content visible.
    const response = NextResponse.json({ game: formattedGame });
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } catch (error) {
    console.error('Failed to fetch game:', error);
    captureException(error, { route: '/api/community/games/[id]' });
    return redactedJson(
      { error: 'Failed to fetch game' },
      { status: 500 }
    );
  }
}

// Egress guard (#9736): every response this route returns leaves through the
// one redaction chokepoint. See `src/lib/security/egressGuard.ts`.
export const GET = withEgressGuard(GET_impl);
