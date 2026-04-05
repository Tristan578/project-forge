import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/lib/api/middleware';
import { getDb } from '@/lib/db/client';
import { publishedGames, leaderboards } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { captureException } from '@/lib/monitoring/sentry-server';

/**
 * Verify the authenticated user owns the published game.
 * Returns the game row if found, or null if the game does not exist or is not owned by the user.
 */
async function verifyGameOwnership(gameId: string, userId: string) {
  const db = getDb();
  const [game] = await db
    .select({ id: publishedGames.id })
    .from(publishedGames)
    .where(and(eq(publishedGames.id, gameId), eq(publishedGames.userId, userId)))
    .limit(1);
  return game ?? null;
}

// GET /api/publish/[id]/leaderboards — list all leaderboards for a game
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const mid = await withApiMiddleware(request, {
    requireAuth: true,
    rateLimit: true,
    rateLimitConfig: { key: (userId) => `user:leaderboard-list:${userId}`, max: 30, windowSeconds: 60 },
  });
  if (mid.error) return mid.error;

  const { id: gameId } = await params;

  try {
    const game = await verifyGameOwnership(gameId, mid.userId!);
    if (!game) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    const db = getDb();
    const boards = await db
      .select({
        name: leaderboards.name,
        sortOrder: leaderboards.sortOrder,
        maxEntries: leaderboards.maxEntries,
        minScore: leaderboards.minScore,
        maxScore: leaderboards.maxScore,
        createdAt: leaderboards.createdAt,
      })
      .from(leaderboards)
      .where(eq(leaderboards.gameId, gameId));

    return NextResponse.json({ leaderboards: boards });
  } catch (err) {
    captureException(err, { route: '/api/publish/[id]/leaderboards', method: 'GET' });
    return NextResponse.json({ error: 'Failed to list leaderboards' }, { status: 500 });
  }
}

// POST /api/publish/[id]/leaderboards — create a new leaderboard
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const mid = await withApiMiddleware(request, {
    requireAuth: true,
    rateLimit: true,
    rateLimitConfig: { key: (userId) => `user:leaderboard-create:${userId}`, max: 10, windowSeconds: 60 },
  });
  if (mid.error) return mid.error;

  const { id: gameId } = await params;

  try {
    const game = await verifyGameOwnership(gameId, mid.userId!);
    if (!game) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > 64) {
      return NextResponse.json({ error: 'name is required and must be 64 characters or fewer' }, { status: 400 });
    }
    // Reject characters that would make the name unaddressable as a URL segment.
    // Next.js already decodes route params, so a name containing '/' or '%' would
    // create leaderboards that cannot be retrieved or deleted via /[name] routes.
    if (/[\/\\%]/.test(name) || /[\x00-\x1f\x7f]/.test(name)) {
      return NextResponse.json(
        { error: 'name must not contain /, \\, %, or control characters' },
        { status: 400 }
      );
    }

    const sortOrder = body.sortOrder === 'asc' ? 'asc' as const : 'desc' as const;
    const maxEntries = typeof body.maxEntries === 'number' && Number.isFinite(body.maxEntries)
      ? Math.min(Math.max(Math.round(body.maxEntries), 1), 1000)
      : 100;
    const minScore = typeof body.minScore === 'number' && Number.isFinite(body.minScore) ? Math.round(body.minScore) : null;
    const maxScore = typeof body.maxScore === 'number' && Number.isFinite(body.maxScore) ? Math.round(body.maxScore) : null;
    if (minScore !== null && maxScore !== null && minScore > maxScore) {
      return NextResponse.json({ error: 'minScore must be <= maxScore' }, { status: 400 });
    }

    const db = getDb();
    const [board] = await db
      .insert(leaderboards)
      .values({ gameId, name, sortOrder, maxEntries, minScore, maxScore })
      .returning({ id: leaderboards.id, name: leaderboards.name });

    return NextResponse.json({ leaderboard: board }, { status: 201 });
  } catch (err) {
    const pgErr = err as { code?: string };
    if (pgErr.code === '23505') {
      return NextResponse.json({ error: 'A leaderboard with this name already exists for this game' }, { status: 409 });
    }
    captureException(err, { route: '/api/publish/[id]/leaderboards', method: 'POST' });
    return NextResponse.json({ error: 'Failed to create leaderboard' }, { status: 500 });
  }
}
