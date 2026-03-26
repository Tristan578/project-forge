import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { gameRatings } from '@/lib/db/schema';
import { eq, sql } from 'drizzle-orm';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { rateLimit, rateLimitResponse } from '@/lib/rateLimit';
import { captureException } from '@/lib/monitoring/sentry-server';

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const db = getDb();
    const authResult = await authenticateRequest();
    if (!authResult.ok) return authResult.response;

    // Rate limit: 30 rating actions per minute per user
    const rl = await rateLimit(`rate:${authResult.ctx.user.id}`, 30, 60_000);
    if (!rl.allowed) return rateLimitResponse(rl.remaining, rl.resetAt);

    const { id: gameId } = await params;
    let body;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const { rating } = body;

    // Validate rating
    if (!rating || rating < 1 || rating > 5) {
      return NextResponse.json(
        { error: 'Rating must be between 1 and 5' },
        { status: 400 }
      );
    }

    // Atomic upsert — eliminates TOCTOU race where concurrent requests
    // both pass the "already rated?" check and both INSERT duplicates.
    // Uses unique index uq_game_ratings_user_game(gameId, userId).
    await db.insert(gameRatings)
      .values({
        gameId,
        userId: authResult.ctx.user.id,
        rating,
      })
      .onConflictDoUpdate({
        target: [gameRatings.gameId, gameRatings.userId],
        set: { rating, updatedAt: new Date() },
      });

    // Get new average and count
    const stats = await db
      .select({
        avgRating: sql<number>`AVG(${gameRatings.rating})`,
        ratingCount: sql<number>`COUNT(*)`,
      })
      .from(gameRatings)
      .where(eq(gameRatings.gameId, gameId));

    return NextResponse.json({
      avgRating: Number(stats[0].avgRating),
      ratingCount: Number(stats[0].ratingCount),
    });
  } catch (error) {
    captureException(error, { route: '/api/community/games/[id]/rate' });
    return NextResponse.json({ error: 'Failed to rate game' }, { status: 500 });
  }
}
