import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { gameComments } from '@/lib/db/schema';
import { inArray } from 'drizzle-orm';
import { assertAdmin } from '@/lib/auth/api-auth';
import { withApiMiddleware } from '@/lib/api/middleware';
import { rateLimitAdminRoute } from '@/lib/rateLimit';
import { captureException } from '@/lib/monitoring/sentry-server';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/moderation/bulk
 * Bulk moderation action on multiple comments.
 * Body: { action: 'approve' | 'delete', commentIds: string[] }
 *
 * FIX (PF-457): Uses .returning() to report actual DB rows affected,
 * not ids.length which was wrong when IDs didn't exist.
 */
export async function POST(req: NextRequest) {
  try {
    const mid = await withApiMiddleware(req, { requireAuth: true });
    if (mid.error) return mid.error;

    const adminError = assertAdmin(mid.authContext!.clerkId);
    if (adminError) return adminError;

    const limited = await rateLimitAdminRoute(mid.userId!, 'admin-moderation-bulk');
    if (limited) return limited;

    const body = await req.json() as unknown;

    if (typeof body !== 'object' || body === null) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const { action, commentIds } = body as Record<string, unknown>;

    if (action !== 'approve' && action !== 'delete') {
      return NextResponse.json(
        { error: 'Action must be "approve" or "delete"' },
        { status: 400 }
      );
    }

    if (!Array.isArray(commentIds) || commentIds.length === 0) {
      return NextResponse.json(
        { error: 'commentIds must be a non-empty array' },
        { status: 400 }
      );
    }

    const invalidIds = (commentIds as unknown[]).filter((id) => typeof id !== 'string');
    if (invalidIds.length > 0) {
      return NextResponse.json(
        { error: 'All commentIds must be strings' },
        { status: 400 }
      );
    }

    const ids = commentIds as string[];
    const errors: string[] = [];
    let processed = 0;
    const db = getDb();

    try {
      if (action === 'approve') {
        const result = await db
          .update(gameComments)
          .set({ flagged: 0 })
          .where(inArray(gameComments.id, ids))
          .returning({ id: gameComments.id });
        processed = result.length;
      } else {
        const result = await db
          .delete(gameComments)
          .where(inArray(gameComments.id, ids))
          .returning({ id: gameComments.id });
        processed = result.length;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      errors.push('Bulk operation failed: ' + message);
    }

    return NextResponse.json({ processed, errors });
  } catch (error) {
    console.error('Failed to perform bulk moderation:', error);
    captureException(error, { route: '/api/admin/moderation/bulk' });
    return NextResponse.json(
      { error: 'Failed to perform bulk moderation' },
      { status: 500 }
    );
  }
}
