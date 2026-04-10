import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb, queryWithResilience } from '@/lib/db/client';
import { moderationAppeals } from '@/lib/db/schema';
import { withApiMiddleware } from '@/lib/api/middleware';
import { rateLimitPublicRoute } from '@/lib/rateLimit';
import { captureException } from '@/lib/monitoring/sentry-server';

export const dynamic = 'force-dynamic';

const appealSchema = z.object({
  contentId: z.string().min(1).max(100),
  contentType: z.enum(['comment', 'asset', 'game']),
  reason: z.string().trim().min(10).max(2000),
});

/**
 * POST /api/moderation/appeal
 * Authenticated users can submit an appeal for blocked/flagged content.
 * Body: { contentId, contentType, reason }
 */
export async function POST(req: NextRequest) {
  // Rate limit: 5 appeals per 10 minutes per IP — prevents spam appeal submission
  const limited = await rateLimitPublicRoute(req, 'moderation-appeal', 5, 600_000);
  if (limited) return limited;

  try {
    const mid = await withApiMiddleware(req, { requireAuth: true, validate: appealSchema });
    if (mid.error) return mid.error;

    const { contentId, contentType, reason } = mid.body as z.infer<typeof appealSchema>;

    const [appeal] = await queryWithResilience(() =>
      getDb()
        .insert(moderationAppeals)
        .values({
          userId: mid.userId!,
          contentId,
          contentType,
          reason,
        })
        .returning()
    );

    return NextResponse.json({ id: appeal.id, status: appeal.status }, { status: 201 });
  } catch (error) {
    captureException(error, { route: '/api/moderation/appeal' });
    return NextResponse.json(
      { error: 'Failed to submit appeal' },
      { status: 500 }
    );
  }
}
