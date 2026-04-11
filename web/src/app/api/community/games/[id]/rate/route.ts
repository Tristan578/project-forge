import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb, queryWithResilience } from '@/lib/db/client';
import { gameRatings } from '@/lib/db/schema';
import { eq, sql } from 'drizzle-orm';
import { withApiMiddleware } from '@/lib/api/middleware';
import { captureException } from '@/lib/monitoring/sentry-server';

export const dynamic = 'force-dynamic';

const rateSchema = z.object({
  rating: z.number().finite().min(1).max(5),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const mid = await withApiMiddleware(req, {
      requireAuth: true,
      rateLimit: true,
      rateLimitConfig: { key: (id) => `rate:${id}`, max: 30, windowSeconds: 60 },
      validate: rateSchema,
    });
    if (mid.error) return mid.error;

    const { id: gameId } = await params;
    const { rating } = mid.body as z.infer<typeof rateSchema>;

    // Atomic upsert — eliminates TOCTOU race where concurrent requests
    // both pass the "already rated?" check and both INSERT duplicates.
    // Uses unique index uq_game_ratings_user_game(gameId, userId).
    await queryWithResilience(() => getDb().insert(gameRatings)
      .values({
        gameId,
        userId: mid.userId!,
        rating,
      })
      .onConflictDoUpdate({
        target: [gameRatings.gameId, gameRatings.userId],
        set: { rating, updatedAt: new Date() },
      }));

    // Get new average and count
    const stats = await queryWithResilience(() => getDb()
      .select({
        avgRating: sql<number>`AVG(${gameRatings.rating})`,
        ratingCount: sql<number>`COUNT(*)`,
      })
      .from(gameRatings)
      .where(eq(gameRatings.gameId, gameId)));

    return NextResponse.json({
      avgRating: Number(stats[0].avgRating),
      ratingCount: Number(stats[0].ratingCount),
    });
  } catch (error) {
    captureException(error, { route: '/api/community/games/[id]/rate' });
    return NextResponse.json({ error: 'Failed to rate game' }, { status: 500 });
  }
}
