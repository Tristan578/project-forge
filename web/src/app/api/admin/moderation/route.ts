import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb, getNeonSql, queryWithResilience } from '@/lib/db/client';
import { gameComments, publishedGames, users } from '@/lib/db/schema';
import { eq, desc, count } from 'drizzle-orm';
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
      // Two queries, not one: `total` is the QUEUE DEPTH, and a page's length
      // can never report it. With the default limit of 50, `flaggedGames.length`
      // reads 50 whether there are 50 or 5,000 games waiting — the number an
      // operator would use to decide whether the backlog is under control is
      // exactly the number that is wrong when it matters.
      const [flaggedGames, totalRows] = await Promise.all([
        queryWithResilience(() =>
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
        ),
        queryWithResilience(() =>
          getDb()
            .select({ value: count() })
            .from(publishedGames)
            .where(eq(publishedGames.status, 'flagged'))
        ),
      ]);

      const total = Number(totalRows[0]?.value ?? 0);

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
        total,
        hasMore: offset + flaggedGames.length < total,
      });
    }

    // Fetch flagged comments with author and game info (same page-vs-depth
    // split as the game branch above).
    const [flaggedComments, totalCommentRows] = await Promise.all([
      queryWithResilience(() =>
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
      ),
      queryWithResilience(() =>
        getDb()
          .select({ value: count() })
          .from(gameComments)
          .where(eq(gameComments.flagged, 1))
      ),
    ]);

    const totalComments = Number(totalCommentRows[0]?.value ?? 0);

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
      total: totalComments,
      hasMore: offset + flaggedComments.length < totalComments,
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
 *   approve — LIFT THE MODERATION HOLD. `flagged_at` is what POST /api/publish
 *             refuses to republish over, so clearing it is the whole point of
 *             this action; `status` is secondary. Hence the statement is scoped
 *             on `flagged_at IS NOT NULL` rather than `status = 'flagged'`:
 *             a creator who unpublishes their game while it sits in the queue
 *             leaves a row that is 'unpublished' AND still held, and a
 *             status-scoped approve matched nothing, 404'd, and stranded that
 *             creator permanently unable to republish with no operator action
 *             that could free them. The CASE keeps the other half of the old
 *             scope intact: only a row that was actually 'flagged' goes back to
 *             'published', so approving never republishes something the CREATOR
 *             took down. `report_count` is reset to 0 because the threshold is
 *             counted PER REVIEW CYCLE — see the docblock on
 *             REPORT_AUTOHIDE_THRESHOLD; without the reset any threshold above
 *             1 is decorative after a game's first review.
 *   delete  — soft-remove by setting status='unpublished'. NEVER a row delete:
 *             game_comments, game_ratings, game_likes and game_reports all hold
 *             NOT NULL foreign keys to published_games.id with no ON DELETE
 *             CASCADE, so a hard delete would raise an FK violation or require
 *             a multi-table cascade this route does not implement. flaggedAt is
 *             deliberately left in place as the takedown record — the hold is
 *             the enforcement, and approve (above) or a won appeal is what
 *             lifts it.
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
        // Raw SQL rather than Drizzle: the status update is conditional on the
        // row's OWN current value (see the docblock), which `.set()` cannot
        // express without an inline SQL fragment anyway, and one statement
        // keeps hold-clearing and counter-reset in a single commit — neon-http
        // has no transaction to fall back on.
        const restored = (await queryWithResilience(
          () => getNeonSql()`
            UPDATE published_games
            SET status = CASE
                  WHEN status = 'flagged' THEN 'published'::publish_status
                  ELSE status
                END,
                flagged_at = NULL,
                report_count = 0,
                updated_at = now()
            WHERE id = ${id}::uuid
              AND flagged_at IS NOT NULL
            RETURNING id, status
          `
        )) as unknown as { id: string; status: string }[];

        if (restored.length === 0) {
          return NextResponse.json(
            { error: 'No held game with that id' },
            { status: 404 }
          );
        }

        return NextResponse.json({
          success: true,
          action: 'approved',
          type: 'game',
          // The operator needs to see whether the game went back to public or
          // only had its hold lifted (creator-unpublished rows stay down).
          status: restored[0].status,
        });
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
