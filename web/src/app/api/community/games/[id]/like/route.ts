import { NextRequest, NextResponse } from 'next/server';
import { getDb, queryWithResilience } from '@/lib/db/client';
import { gameLikes } from '@/lib/db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { withApiMiddleware } from '@/lib/api/middleware';
import { captureException } from '@/lib/monitoring/sentry-server';
import { redactedJson } from '@/lib/api/errors';
import { withEgressGuard } from '@/lib/security/egressGuard';

export const dynamic = 'force-dynamic';

async function POST_impl(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const mid = await withApiMiddleware(req, {
      requireAuth: true,
      rateLimit: true,
      rateLimitConfig: { key: (id) => `like:${id}`, max: 30, windowSeconds: 60 },
    });
    if (mid.error) return mid.error;

    const { id: gameId } = await params;

    // Atomic upsert — eliminates TOCTOU race where concurrent likes both
    // pass the existence check. Uses unique index uq_game_likes_user_game.
    const inserted = await queryWithResilience(() => getDb().insert(gameLikes)
      .values({
        gameId,
        userId: mid.userId!,
      })
      .onConflictDoNothing({
        target: [gameLikes.gameId, gameLikes.userId],
      })
      .returning({ id: gameLikes.id }));

    if (inserted.length === 0) {
      // Already liked — return current count
      const count = await queryWithResilience(() => getDb()
        .select({ count: sql<number>`COUNT(*)` })
        .from(gameLikes)
        .where(eq(gameLikes.gameId, gameId)));
      return NextResponse.json({ liked: true, likeCount: Number(count[0].count) });
    }

    // Get new count
    const count = await queryWithResilience(() => getDb()
      .select({ count: sql<number>`COUNT(*)` })
      .from(gameLikes)
      .where(eq(gameLikes.gameId, gameId)));

    return NextResponse.json({ liked: true, likeCount: Number(count[0].count) });
  } catch (error) {
    captureException(error, { route: '/api/community/games/[id]/like', method: 'POST' });
    return redactedJson({ error: 'Failed to like game' }, { status: 500 });
  }
}

async function DELETE_impl(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const mid = await withApiMiddleware(req, {
      requireAuth: true,
      rateLimit: true,
      rateLimitConfig: { key: (id) => `like:${id}`, max: 30, windowSeconds: 60 },
    });
    if (mid.error) return mid.error;

    const { id: gameId } = await params;

    // Remove like
    await queryWithResilience(() => getDb()
      .delete(gameLikes)
      .where(and(eq(gameLikes.gameId, gameId), eq(gameLikes.userId, mid.userId!))));

    // Get new count
    const count = await queryWithResilience(() => getDb()
      .select({ count: sql<number>`COUNT(*)` })
      .from(gameLikes)
      .where(eq(gameLikes.gameId, gameId)));

    return NextResponse.json({ liked: false, likeCount: Number(count[0].count) });
  } catch (error) {
    captureException(error, { route: '/api/community/games/[id]/like', method: 'DELETE' });
    return redactedJson({ error: 'Failed to unlike game' }, { status: 500 });
  }
}

// Egress guard (#9736): every response this route returns leaves through the
// one redaction chokepoint. See `src/lib/security/egressGuard.ts`.
export const POST = withEgressGuard(POST_impl);
export const DELETE = withEgressGuard(DELETE_impl);
