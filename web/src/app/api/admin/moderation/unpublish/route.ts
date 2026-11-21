import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb, queryWithResilience } from '@/lib/db/client';
import { publishedGames } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { assertAdmin } from '@/lib/auth/api-auth';
import { withApiMiddleware } from '@/lib/api/middleware';
import { rateLimitAdminRoute } from '@/lib/rateLimit';
import { logger } from '@/lib/logging/logger';
import { captureException } from '@/lib/monitoring/sentry-server';

export const dynamic = 'force-dynamic';

const unpublishSchema = z.object({
  gameId: z.string().min(1).max(100),
  reason: z.string().trim().max(500).optional(),
});

/**
 * POST /api/admin/moderation/unpublish
 * Admin-only: sets a published game's status to 'unpublished'.
 * Used for DMCA/IP-infringement takedowns and policy violations.
 * Body: { gameId: string, reason?: string }
 */
export async function POST(req: NextRequest) {
  try {
    const mid = await withApiMiddleware(req, {
      requireAuth: true,
      validate: unpublishSchema,
    });
    if (mid.error) return mid.error;

    const adminError = assertAdmin(mid.authContext!.clerkId);
    if (adminError) return adminError;

    const rateLimitError = await rateLimitAdminRoute(mid.userId!, 'admin-unpublish');
    if (rateLimitError) return rateLimitError;

    const { gameId, reason } = mid.body as z.infer<typeof unpublishSchema>;
    const reqLog = logger.child({
      endpoint: 'POST /api/admin/moderation/unpublish',
      adminId: mid.userId,
      gameId,
    });

    // Verify the game exists
    const [game] = await queryWithResilience(() =>
      getDb()
        .select({ id: publishedGames.id, title: publishedGames.title, status: publishedGames.status })
        .from(publishedGames)
        .where(eq(publishedGames.id, gameId))
        .limit(1)
    );

    if (!game) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    await queryWithResilience(() =>
      getDb()
        .update(publishedGames)
        .set({ status: 'unpublished', updatedAt: new Date() })
        .where(eq(publishedGames.id, gameId))
    );

    reqLog.info('Admin unpublished game', {
      gameTitle: game.title,
      previousStatus: game.status,
      reason: reason ?? 'not specified',
    });

    return NextResponse.json({
      success: true,
      gameId,
      previousStatus: game.status,
      newStatus: 'unpublished',
    });
  } catch (error) {
    captureException(error, { route: '/api/admin/moderation/unpublish', method: 'POST' });
    return NextResponse.json(
      { error: 'Failed to unpublish game' },
      { status: 500 }
    );
  }
}
