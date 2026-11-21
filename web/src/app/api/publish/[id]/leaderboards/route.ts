import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withApiMiddleware } from '@/lib/api/middleware';
import { getDb, queryWithResilience } from '@/lib/db/client';
import { publishedGames, leaderboards } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { captureException } from '@/lib/monitoring/sentry-server';

const createLeaderboardSchema = z.object({
  name: z.string().trim().min(1).max(64),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  maxEntries: z.number().finite().optional(),
  minScore: z.number().finite().nullish(),
  maxScore: z.number().finite().nullish(),
});

/**
 * Verify the authenticated user owns the published game.
 * Returns the game row if found, or null if the game does not exist or is not owned by the user.
 */
async function verifyGameOwnership(gameId: string, userId: string) {
  const [game] = await queryWithResilience(() => getDb()
    .select({ id: publishedGames.id })
    .from(publishedGames)
    .where(and(eq(publishedGames.id, gameId), eq(publishedGames.userId, userId)))
    .limit(1));
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

    const boards = await queryWithResilience(() => getDb()
      .select({
        name: leaderboards.name,
        sortOrder: leaderboards.sortOrder,
        maxEntries: leaderboards.maxEntries,
        minScore: leaderboards.minScore,
        maxScore: leaderboards.maxScore,
        createdAt: leaderboards.createdAt,
      })
      .from(leaderboards)
      .where(eq(leaderboards.gameId, gameId)));

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
    validate: createLeaderboardSchema,
  });
  if (mid.error) return mid.error;

  const { id: gameId } = await params;

  try {
    const game = await verifyGameOwnership(gameId, mid.userId!);
    if (!game) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    const parsed = mid.body as z.infer<typeof createLeaderboardSchema>;
    const name = parsed.name;
    // Reject characters that would make the name unaddressable as a URL segment.
    // Next.js already decodes route params, so a name containing '/' or '%' would
    // create leaderboards that cannot be retrieved or deleted via /[name] routes.
    if (/[\/\\%]/.test(name) || /[\x00-\x1f\x7f]/.test(name)) {
      return NextResponse.json(
        { error: 'name must not contain /, \\, %, or control characters' },
        { status: 400 }
      );
    }

    const sortOrder = parsed.sortOrder ?? 'desc';
    const maxEntries = parsed.maxEntries !== undefined
      ? Math.min(Math.max(Math.round(parsed.maxEntries), 1), 1000)
      : 100;
    const minScore = parsed.minScore != null ? Math.round(parsed.minScore) : null;
    const maxScore = parsed.maxScore != null ? Math.round(parsed.maxScore) : null;
    if (minScore !== null && maxScore !== null && minScore > maxScore) {
      return NextResponse.json({ error: 'minScore must be <= maxScore' }, { status: 400 });
    }

    const [board] = await queryWithResilience(() => getDb()
      .insert(leaderboards)
      .values({ gameId, name, sortOrder, maxEntries, minScore, maxScore })
      .returning({ id: leaderboards.id, name: leaderboards.name }));

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
