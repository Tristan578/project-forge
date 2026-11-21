import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { getDb, queryWithResilience } from '@/lib/db/client';
import {
  moderationAppeals,
  gameComments,
  publishedGames,
  marketplaceAssets,
} from '@/lib/db/schema';
import { withApiMiddleware } from '@/lib/api/middleware';
import { rateLimitPublicRoute } from '@/lib/rateLimit';
import { captureException } from '@/lib/monitoring/sentry-server';

export const dynamic = 'force-dynamic';

const appealSchema = z.object({
  // All three appealable content types are keyed by a uuid primary key, so the
  // contentId must be a uuid — rejecting malformed ids early (400) instead of
  // letting an invalid uuid cast surface as a 500 in the ownership lookup.
  contentId: z.string().uuid(),
  contentType: z.enum(['comment', 'asset', 'game']),
  reason: z.string().trim().min(10).max(2000),
});

/**
 * Resolve the owning user id for a piece of appealable content, or null if it
 * does not exist. Comments and games are owned by `userId`; marketplace assets
 * by `sellerId`.
 */
async function resolveContentOwner(
  contentType: 'comment' | 'asset' | 'game',
  contentId: string
): Promise<string | null> {
  if (contentType === 'comment') {
    const [row] = await queryWithResilience(() =>
      getDb()
        .select({ ownerId: gameComments.userId })
        .from(gameComments)
        .where(eq(gameComments.id, contentId))
        .limit(1)
    );
    return row?.ownerId ?? null;
  }
  if (contentType === 'game') {
    const [row] = await queryWithResilience(() =>
      getDb()
        .select({ ownerId: publishedGames.userId })
        .from(publishedGames)
        .where(eq(publishedGames.id, contentId))
        .limit(1)
    );
    return row?.ownerId ?? null;
  }
  const [row] = await queryWithResilience(() =>
    getDb()
      .select({ ownerId: marketplaceAssets.sellerId })
      .from(marketplaceAssets)
      .where(eq(marketplaceAssets.id, contentId))
      .limit(1)
  );
  return row?.ownerId ?? null;
}

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

    // Authz: only the author/owner of the content may appeal its moderation.
    // Without this check, any authenticated user could spam the moderation
    // queue with appeals about other people's content and — if an admin
    // approved one — get a comment they never authored unflagged (#8613).
    // Return 404 (not 403) so we don't disclose whether the content exists.
    const ownerId = await resolveContentOwner(contentType, contentId);
    if (ownerId === null || ownerId !== mid.userId!) {
      return NextResponse.json({ error: 'Content not found' }, { status: 404 });
    }

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
