import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { gameLikes } from '@/lib/db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { withApiMiddleware } from '@/lib/api/middleware';
import { captureException } from '@/lib/monitoring/sentry-server';

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const db = getDb();
    const mid = await withApiMiddleware(req, {
      requireAuth: true,
      rateLimit: true,
      rateLimitConfig: { key: (id) => `like:${id}`, max: 30, windowSeconds: 60 },
    });
    if (mid.error) return mid.error;

    const { id: gameId } = await params;

    // Atomic upsert — eliminates TOCTOU race where concurrent likes both
    // pass the existence check. Uses unique index uq_game_likes_user_game.
    const inserted = await db.insert(gameLikes)
      .values({
        gameId,
        userId: mid.userId!,
      })
      .onConflictDoNothing({
        target: [gameLikes.gameId, gameLikes.userId],
      })
      .returning({ id: gameLikes.id });

    if (inserted.length === 0) {
      // Already liked — return current count
      const count = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(gameLikes)
        .where(eq(gameLikes.gameId, gameId));
      return NextResponse.json({ liked: true, likeCount: Number(count[0].count) });
    }

    // Get new count
    const count = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(gameLikes)
      .where(eq(gameLikes.gameId, gameId));

    return NextResponse.json({ liked: true, likeCount: Number(count[0].count) });
  } catch (error) {
    captureException(error, { route: '/api/community/games/[id]/like', method: 'POST' });
    return NextResponse.json({ error: 'Failed to like game' }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const db = getDb();
    const mid = await withApiMiddleware(req, {
      requireAuth: true,
      rateLimit: true,
      rateLimitConfig: { key: (id) => `like:${id}`, max: 30, windowSeconds: 60 },
    });
    if (mid.error) return mid.error;

    const { id: gameId } = await params;

    // Remove like
    await db
      .delete(gameLikes)
      .where(and(eq(gameLikes.gameId, gameId), eq(gameLikes.userId, mid.userId!)));

    // Get new count
    const count = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(gameLikes)
      .where(eq(gameLikes.gameId, gameId));

    return NextResponse.json({ liked: false, likeCount: Number(count[0].count) });
  } catch (error) {
    captureException(error, { route: '/api/community/games/[id]/like', method: 'DELETE' });
    return NextResponse.json({ error: 'Failed to unlike game' }, { status: 500 });
  }
}
