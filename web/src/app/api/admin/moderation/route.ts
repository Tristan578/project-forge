import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb, queryWithResilience } from '@/lib/db/client';
import { gameComments, publishedGames, users } from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';
import { assertAdmin } from '@/lib/auth/api-auth';
import { withApiMiddleware } from '@/lib/api/middleware';
import { rateLimitAdminRoute } from '@/lib/rateLimit';
import { parsePaginationParams } from '@/lib/apiValidation';
import { captureException } from '@/lib/monitoring/sentry-server';

export const dynamic = 'force-dynamic';

const moderationActionSchema = z.object({
  id: z.string().min(1).max(100),
  action: z.enum(['approve', 'delete']),
});

/**
 * GET /api/admin/moderation
 * Returns flagged comments for admin review.
 * Supports pagination via ?limit=N&offset=N
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
 * Perform moderation action on flagged content.
 * Body: { id, action: 'approve' | 'delete' }
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

    const { id, action } = mid.body as z.infer<typeof moderationActionSchema>;

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
