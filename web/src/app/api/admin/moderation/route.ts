import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb, queryWithResilience } from '@/lib/db/client';
import { gameComments, publishedGames, users } from '@/lib/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { assertAdmin } from '@/lib/auth/api-auth';
import { withApiMiddleware } from '@/lib/api/middleware';
import { rateLimitAdminRoute } from '@/lib/rateLimit';
import { parsePaginationParams } from '@/lib/apiValidation';
import { captureException } from '@/lib/monitoring/sentry-server';

export const dynamic = 'force-dynamic';

const moderationActionSchema = z.object({
  id: z.string().min(1).max(100),
  type: z.enum(['comment', 'game']).optional().default('comment'),
  action: z.enum(['approve', 'delete']),
});

// published_games.id is a uuid column, so a non-uuid id can never name a game.
// Reject the shape before it reaches Postgres (which would raise
// `invalid input syntax for type uuid` — a 500 for what is really a 404).
// The comment branch stays permissive: game_comments ids come from the queue
// payload and are not re-validated here.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/admin/moderation
 * Returns the moderation queue for admin review.
 *
 * ?type=comment (default) — flagged comments.
 * ?type=game               — games auto-hidden by viewer reports (#8354),
 *                            i.e. published_games rows with status='flagged'.
 * Supports pagination via ?limit=N&offset=N.
 *
 * NOTE: a game has no single reporter — several users can report the same game
 * — so the join surfaces the game's CREATOR, not a reporter. `reportCount` is
 * how many distinct users have reported it.
 */
export async function GET(req: NextRequest) {
  try {
    const mid = await withApiMiddleware(req, { requireAuth: true });
    if (mid.error) return mid.error;

    const adminError = assertAdmin(mid.authContext!.clerkId);
    if (adminError) return adminError;

    const rateLimitError = await rateLimitAdminRoute(mid.userId!, 'admin-moderation');
    if (rateLimitError) return rateLimitError;

    const searchParams = req.nextUrl.searchParams;
    const { limit, offset } = parsePaginationParams(searchParams, { defaultLimit: 50 });

    const typeParam = searchParams.get('type');
    if (typeParam !== null && typeParam !== 'comment' && typeParam !== 'game') {
      return NextResponse.json(
        { error: "Invalid type — expected 'comment' or 'game'" },
        { status: 400 }
      );
    }

    if (typeParam === 'game') {
      const flaggedGames = await queryWithResilience(() =>
        getDb()
          .select({
            id: publishedGames.id,
            title: publishedGames.title,
            slug: publishedGames.slug,
            authorId: publishedGames.userId,
            authorName: users.displayName,
            authorEmail: users.email,
            reportCount: publishedGames.reportCount,
            flaggedAt: publishedGames.flaggedAt,
          })
          .from(publishedGames)
          .leftJoin(users, eq(publishedGames.userId, users.id))
          .where(eq(publishedGames.status, 'flagged'))
          .orderBy(desc(publishedGames.flaggedAt))
          .limit(limit)
          .offset(offset)
      );

      return NextResponse.json({
        items: flaggedGames.map((g) => ({
          // `id` and `gameId` carry the same value on purpose: the POST below
          // keys off `id`, and the comment queue's item shape also uses `id`.
          id: g.id,
          type: 'game' as const,
          gameId: g.id,
          title: g.title,
          slug: g.slug,
          authorId: g.authorId,
          authorName: g.authorName || 'Unknown',
          authorEmail: g.authorEmail,
          reportCount: g.reportCount,
          flaggedAt: g.flaggedAt ? g.flaggedAt.toISOString() : null,
        })),
        total: flaggedGames.length,
      });
    }

    // Fetch flagged comments with author and game info
    const flaggedComments = await queryWithResilience(() =>
      getDb()
        .select({
          id: gameComments.id,
          content: gameComments.content,
          gameId: gameComments.gameId,
          gameTitle: publishedGames.title,
          authorId: gameComments.userId,
          authorName: users.displayName,
          authorEmail: users.email,
          createdAt: gameComments.createdAt,
        })
        .from(gameComments)
        .leftJoin(publishedGames, eq(gameComments.gameId, publishedGames.id))
        .leftJoin(users, eq(gameComments.userId, users.id))
        .where(eq(gameComments.flagged, 1))
        .orderBy(desc(gameComments.createdAt))
        .limit(limit)
        .offset(offset)
    );

    return NextResponse.json({
      items: flaggedComments.map((c) => ({
        id: c.id,
        type: 'comment' as const,
        content: c.content,
        gameId: c.gameId,
        gameTitle: c.gameTitle || 'Unknown',
        authorId: c.authorId,
        authorName: c.authorName || 'Unknown',
        authorEmail: c.authorEmail,
        createdAt: c.createdAt.toISOString(),
      })),
      total: flaggedComments.length,
    });
  } catch (error) {
    captureException(error, { route: '/api/admin/moderation', method: 'GET' });
    console.error('Failed to fetch moderation queue:', error);
    return NextResponse.json(
      { error: 'Failed to fetch moderation queue' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/moderation
 * Perform a moderation action on queued content.
 * Body: { id, type?: 'comment' | 'game', action: 'approve' | 'delete' }
 *
 * For type='game' (#8354):
 *   approve — restore status to 'published' and clear flaggedAt. Scoped to rows
 *             that are currently 'flagged', so an approve on a stale queue entry
 *             can never republish a game the CREATOR has since unpublished.
 *   delete  — soft-remove by setting status='unpublished'. NEVER a row delete:
 *             game_comments, game_ratings, game_likes and game_reports all hold
 *             NOT NULL foreign keys to published_games.id with no ON DELETE
 *             CASCADE, so a hard delete would raise an FK violation or require
 *             a multi-table cascade this route does not implement. flaggedAt is
 *             deliberately left in place as the takedown record.
 */
export async function POST(req: NextRequest) {
  try {
    const mid = await withApiMiddleware(req, {
      requireAuth: true,
      validate: moderationActionSchema,
    });
    if (mid.error) return mid.error;

    const adminError = assertAdmin(mid.authContext!.clerkId);
    if (adminError) return adminError;

    const rateLimitError = await rateLimitAdminRoute(mid.userId!, 'admin-moderation');
    if (rateLimitError) return rateLimitError;

    const { id, type, action } = mid.body as z.infer<typeof moderationActionSchema>;

    if (type === 'game') {
      if (!UUID_RE.test(id)) {
        return NextResponse.json({ error: 'Game not found' }, { status: 404 });
      }

      if (action === 'approve') {
        const restored = await queryWithResilience(() =>
          getDb()
            .update(publishedGames)
            .set({ status: 'published', flaggedAt: null, updatedAt: new Date() })
            .where(
              and(
                eq(publishedGames.id, id),
                eq(publishedGames.status, 'flagged')
              )
            )
            .returning({ id: publishedGames.id })
        );

        if (restored.length === 0) {
          return NextResponse.json(
            { error: 'No flagged game with that id' },
            { status: 404 }
          );
        }

        return NextResponse.json({ success: true, action: 'approved', type: 'game' });
      }

      const removed = await queryWithResilience(() =>
        getDb()
          .update(publishedGames)
          .set({ status: 'unpublished', updatedAt: new Date() })
          .where(eq(publishedGames.id, id))
          .returning({ id: publishedGames.id })
      );

      if (removed.length === 0) {
        return NextResponse.json({ error: 'Game not found' }, { status: 404 });
      }

      return NextResponse.json({ success: true, action: 'deleted', type: 'game' });
    }

    if (action === 'approve') {
      // Unflag the comment (set flagged=0)
      await queryWithResilience(() =>
        getDb()
          .update(gameComments)
          .set({ flagged: 0 })
          .where(eq(gameComments.id, id))
      );

      return NextResponse.json({ success: true, action: 'approved' });
    }

    // Delete the comment
    await queryWithResilience(() =>
      getDb().delete(gameComments).where(eq(gameComments.id, id))
    );

    return NextResponse.json({ success: true, action: 'deleted' });
  } catch (error) {
    captureException(error, { route: '/api/admin/moderation', method: 'POST' });
    console.error('Failed to perform moderation action:', error);
    return NextResponse.json(
      { error: 'Failed to perform moderation action' },
      { status: 500 }
    );
  }
}
