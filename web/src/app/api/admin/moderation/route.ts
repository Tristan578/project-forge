import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { gameComments, publishedGames, users } from '@/lib/db/schema';
import { eq, desc } from 'drizzle-orm';
import { assertAdmin } from '@/lib/auth/api-auth';
import { withApiMiddleware } from '@/lib/api/middleware';
import { rateLimitAdminRoute } from '@/lib/rateLimit';
import { parsePaginationParams } from '@/lib/apiValidation';
import { captureException } from '@/lib/monitoring/sentry-server';

export const dynamic = 'force-dynamic';

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

    const rateLimitError = await rateLimitAdminRoute(mid.authContext!.clerkId, 'admin-moderation');
    if (rateLimitError) return rateLimitError;

    const db = getDb();
    const searchParams = req.nextUrl.searchParams;
    const { limit, offset } = parsePaginationParams(searchParams, { defaultLimit: 50 });

    // Fetch flagged comments with author and game info
    const flaggedComments = await db
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
      .offset(offset);

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
    const mid = await withApiMiddleware(req, { requireAuth: true });
    if (mid.error) return mid.error;

    const adminError = assertAdmin(mid.authContext!.clerkId);
    if (adminError) return adminError;

    const rateLimitError = await rateLimitAdminRoute(mid.authContext!.clerkId, 'admin-moderation');
    if (rateLimitError) return rateLimitError;

    const db = getDb();
    const body: unknown = await req.json();
    if (typeof body !== 'object' || body === null) {
      return NextResponse.json({ error: 'Request body must be a JSON object' }, { status: 400 });
    }
    const { id, action } = body as { id?: string; action?: string };

    if (!id || !action) {
      return NextResponse.json({ error: 'Missing id or action' }, { status: 400 });
    }

    if (action !== 'approve' && action !== 'delete') {
      return NextResponse.json(
        { error: 'Action must be "approve" or "delete"' },
        { status: 400 }
      );
    }

    if (action === 'approve') {
      // Unflag the comment (set flagged=0)
      await db
        .update(gameComments)
        .set({ flagged: 0 })
        .where(eq(gameComments.id, id));

      return NextResponse.json({ success: true, action: 'approved' });
    }

    // Delete the comment
    await db.delete(gameComments).where(eq(gameComments.id, id));

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
