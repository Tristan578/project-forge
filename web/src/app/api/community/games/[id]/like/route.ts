import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { gameLikes } from '@/lib/db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { rateLimit, rateLimitResponse } from '@/lib/rateLimit';
import { captureException } from '@/lib/monitoring/sentry-server';

export const dynamic = 'force-dynamic';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const db = getDb();
    const authResult = await authenticateRequest();
    if (!authResult.ok) return authResult.response;

    // Rate limit: 30 like/unlike actions per minute per user
    const rl = await rateLimit(`like:${authResult.ctx.user.id}`, 30, 60_000);
    if (!rl.allowed) return rateLimitResponse(rl.remaining, rl.resetAt);

    const { id: gameId } = await params;

    // Check if already liked
    const existing = await db
      .select()
      .from(gameLikes)
      .where(and(eq(gameLikes.gameId, gameId), eq(gameLikes.userId, authResult.ctx.user.id)))
      .limit(1);

    if (existing.length > 0) {
      // Already liked, return current count
      const count = await db
        .select({ count: sql<number>`COUNT(*)` })
        .from(gameLikes)
        .where(eq(gameLikes.gameId, gameId));

      return NextResponse.json({ liked: true, likeCount: Number(count[0].count) });
    }

    // Add like
    await db.insert(gameLikes).values({
      gameId,
      userId: authResult.ctx.user.id,
    });

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
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const db = getDb();
    const authResult = await authenticateRequest();
    if (!authResult.ok) return authResult.response;

    const { id: gameId } = await params;

    // Remove like
    await db
      .delete(gameLikes)
      .where(and(eq(gameLikes.gameId, gameId), eq(gameLikes.userId, authResult.ctx.user.id)));

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
