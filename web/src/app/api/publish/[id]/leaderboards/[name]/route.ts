import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/lib/api/middleware';
import { getDb } from '@/lib/db/client';
import { publishedGames, leaderboards, leaderboardEntries } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { captureException } from '@/lib/monitoring/sentry-server';

async function verifyGameOwnership(gameId: string, userId: string) {
  const db = getDb();
  const [game] = await db
    .select({ id: publishedGames.id })
    .from(publishedGames)
    .where(and(eq(publishedGames.id, gameId), eq(publishedGames.userId, userId)))
    .limit(1);
  return game ?? null;
}

async function findBoard(gameId: string, boardName: string) {
  const db = getDb();
  const [board] = await db
    .select()
    .from(leaderboards)
    .where(and(eq(leaderboards.gameId, gameId), eq(leaderboards.name, boardName)))
    .limit(1);
  return board ?? null;
}

// PATCH /api/publish/[id]/leaderboards/[name] — update leaderboard config
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; name: string }> }
) {
  const mid = await withApiMiddleware(request, {
    requireAuth: true,
    rateLimit: true,
    rateLimitConfig: { key: (userId) => `user:leaderboard-config:${userId}`, max: 20, windowSeconds: 60 },
  });
  if (mid.error) return mid.error;

  const { id: gameId, name: boardName } = await params;

  try {
    const game = await verifyGameOwnership(gameId, mid.userId!);
    if (!game) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    const board = await findBoard(gameId, decodeURIComponent(boardName));
    if (!board) {
      return NextResponse.json({ error: 'Leaderboard not found' }, { status: 404 });
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const updates: Record<string, unknown> = {};
    if (body.sortOrder === 'asc' || body.sortOrder === 'desc') updates.sortOrder = body.sortOrder;
    if (typeof body.maxEntries === 'number' && Number.isFinite(body.maxEntries)) {
      updates.maxEntries = Math.min(Math.max(Math.round(body.maxEntries), 1), 1000);
    }
    if (body.minScore === null) updates.minScore = null;
    else if (typeof body.minScore === 'number' && Number.isFinite(body.minScore)) updates.minScore = Math.round(body.minScore);
    if (body.maxScore === null) updates.maxScore = null;
    else if (typeof body.maxScore === 'number' && Number.isFinite(body.maxScore)) updates.maxScore = Math.round(body.maxScore);

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    const db = getDb();
    await db.update(leaderboards).set(updates).where(eq(leaderboards.id, board.id));

    return NextResponse.json({ success: true, updated: Object.keys(updates) });
  } catch (err) {
    captureException(err, { route: '/api/publish/[id]/leaderboards/[name]', method: 'PATCH' });
    return NextResponse.json({ error: 'Failed to update leaderboard' }, { status: 500 });
  }
}

// DELETE /api/publish/[id]/leaderboards/[name] — delete leaderboard and all entries
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; name: string }> }
) {
  const mid = await withApiMiddleware(request, {
    requireAuth: true,
    rateLimit: true,
    rateLimitConfig: { key: (userId) => `user:leaderboard-delete:${userId}`, max: 5, windowSeconds: 60 },
  });
  if (mid.error) return mid.error;

  const { id: gameId, name: boardName } = await params;

  try {
    const game = await verifyGameOwnership(gameId, mid.userId!);
    if (!game) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    const board = await findBoard(gameId, decodeURIComponent(boardName));
    if (!board) {
      return NextResponse.json({ error: 'Leaderboard not found' }, { status: 404 });
    }

    const db = getDb();
    // Entries cascade-delete via FK constraint
    await db.delete(leaderboards).where(eq(leaderboards.id, board.id));

    return NextResponse.json({ success: true });
  } catch (err) {
    captureException(err, { route: '/api/publish/[id]/leaderboards/[name]', method: 'DELETE' });
    return NextResponse.json({ error: 'Failed to delete leaderboard' }, { status: 500 });
  }
}
