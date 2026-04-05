import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/lib/api/middleware';
import { getDb, queryWithResilience } from '@/lib/db/client';
import { publishedGames, leaderboards } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { captureException } from '@/lib/monitoring/sentry-server';

async function verifyGameOwnership(gameId: string, userId: string) {
  const [game] = await queryWithResilience(() => getDb()
    .select({ id: publishedGames.id })
    .from(publishedGames)
    .where(and(eq(publishedGames.id, gameId), eq(publishedGames.userId, userId)))
    .limit(1));
  return game ?? null;
}

async function findBoard(gameId: string, boardName: string) {
  const [board] = await queryWithResilience(() => getDb()
    .select()
    .from(leaderboards)
    .where(and(eq(leaderboards.gameId, gameId), eq(leaderboards.name, boardName)))
    .limit(1));
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

  // Next.js already decodes route params — do not call decodeURIComponent again
  // (double-decoding breaks names containing '%', e.g. '%25' → '%' → URIError).
  const { id: gameId, name: rawBoardName } = await params;

  // Reject names with characters that would make the board unaddressable or that
  // indicate malformed percent-encoding from the URL layer.
  if (/[\/\\%]/.test(rawBoardName) || /[\x00-\x1f\x7f]/.test(rawBoardName)) {
    return NextResponse.json({ error: 'Invalid leaderboard name' }, { status: 400 });
  }
  const boardName = rawBoardName;

  try {
    const game = await verifyGameOwnership(gameId, mid.userId!);
    if (!game) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    const board = await findBoard(gameId, boardName);
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
    const minScore = body.minScore === null ? null
      : (typeof body.minScore === 'number' && Number.isFinite(body.minScore)) ? Math.round(body.minScore) : undefined;
    const maxScore = body.maxScore === null ? null
      : (typeof body.maxScore === 'number' && Number.isFinite(body.maxScore)) ? Math.round(body.maxScore) : undefined;

    // Validate the resulting min/max range using existing DB values for fields not in this update.
    // A partial PATCH (e.g. only minScore) must still satisfy minScore <= maxScore after the update.
    const nextMin = minScore !== undefined ? minScore : board.minScore;
    const nextMax = maxScore !== undefined ? maxScore : board.maxScore;
    if (
      typeof nextMin === 'number' &&
      typeof nextMax === 'number' &&
      nextMin > nextMax
    ) {
      return NextResponse.json({ error: 'minScore must be <= maxScore' }, { status: 400 });
    }

    if (minScore !== undefined) updates.minScore = minScore;
    if (maxScore !== undefined) updates.maxScore = maxScore;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    await queryWithResilience(() => getDb().update(leaderboards).set(updates).where(eq(leaderboards.id, board.id)));

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

  // Next.js already decodes route params — do not call decodeURIComponent again.
  const { id: gameId, name: rawBoardName } = await params;

  if (/[\/\\%]/.test(rawBoardName) || /[\x00-\x1f\x7f]/.test(rawBoardName)) {
    return NextResponse.json({ error: 'Invalid leaderboard name' }, { status: 400 });
  }
  const boardName = rawBoardName;

  try {
    const game = await verifyGameOwnership(gameId, mid.userId!);
    if (!game) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    const board = await findBoard(gameId, boardName);
    if (!board) {
      return NextResponse.json({ error: 'Leaderboard not found' }, { status: 404 });
    }

    // Entries cascade-delete via FK constraint
    await queryWithResilience(() => getDb().delete(leaderboards).where(eq(leaderboards.id, board.id)));

    return NextResponse.json({ success: true });
  } catch (err) {
    captureException(err, { route: '/api/publish/[id]/leaderboards/[name]', method: 'DELETE' });
    return NextResponse.json({ error: 'Failed to delete leaderboard' }, { status: 500 });
  }
}
