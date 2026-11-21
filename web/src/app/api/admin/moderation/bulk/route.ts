import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb, queryWithResilience } from '@/lib/db/client';
import { gameComments } from '@/lib/db/schema';
import { inArray } from 'drizzle-orm';
import { assertAdmin } from '@/lib/auth/api-auth';
import { withApiMiddleware } from '@/lib/api/middleware';
import { rateLimitAdminRoute } from '@/lib/rateLimit';
import { captureException } from '@/lib/monitoring/sentry-server';

export const dynamic = 'force-dynamic';

const bulkModerationSchema = z.object({
  action: z.enum(['approve', 'delete']),
  commentIds: z.array(z.string().min(1).max(100)).min(1).max(100),
});

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
    const mid = await withApiMiddleware(req, {
      requireAuth: true,
      validate: bulkModerationSchema,
    });
    if (mid.error) return mid.error;

    const adminError = assertAdmin(mid.authContext!.clerkId);
    if (adminError) return adminError;

    const limited = await rateLimitAdminRoute(mid.userId!, 'admin-moderation-bulk');
    if (limited) return limited;

    const { action, commentIds: ids } = mid.body as z.infer<typeof bulkModerationSchema>;
    const errors: string[] = [];
    let processed = 0;

    try {
      if (action === 'approve') {
        const result = await queryWithResilience(() =>
          getDb()
            .update(gameComments)
            .set({ flagged: 0 })
            .where(inArray(gameComments.id, ids))
            .returning({ id: gameComments.id })
        );
        processed = result.length;
      } else {
        const result = await queryWithResilience(() =>
          getDb()
            .delete(gameComments)
            .where(inArray(gameComments.id, ids))
            .returning({ id: gameComments.id })
        );
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
