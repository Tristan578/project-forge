import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { getDb, getNeonSql, queryWithResilience } from '@/lib/db/client';
import { publishedGames, users, leaderboards, leaderboardEntries } from '@/lib/db/schema';
import { eq, and, desc, asc, gt, count, lt } from 'drizzle-orm';
import { rateLimitPublicRoute, getClientIp } from '@/lib/rateLimit';
import { captureException } from '@/lib/monitoring/sentry-server';

export const dynamic = 'force-dynamic';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve a published game by clerk userId + slug.
 * Returns { id } or null if not found / not published.
 */
async function resolvePublishedGame(clerkId: string, slug: string) {
  const [user] = await queryWithResilience(() => getDb()
    .select({ id: users.id })
    .from(users)
    .where(eq(users.clerkId, clerkId))
    .limit(1));

  if (!user) return null;

  const [game] = await queryWithResilience(() => getDb()
    .select({ id: publishedGames.id, status: publishedGames.status })
    .from(publishedGames)
    .where(and(eq(publishedGames.userId, user.id), eq(publishedGames.slug, slug)))
    .limit(1));

  if (!game || game.status !== 'published') return null;
  return game;
}

/**
 * Hash an IP address with a daily salt for privacy-preserving deduplication.
 * The salt rotates daily so stored hashes are not linkable across days.
 *
 * When the IP is undeterminable ('unknown'), a random per-request nonce is
 * used instead, ensuring unknown-IP users cannot falsely collide with each other.
 */
function hashIp(ip: string): string {
  const daySalt = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const key = ip === 'unknown' ? `nonce:${Math.random().toString(36).slice(2)}` : ip;
  return createHash('sha256').update(`${key}:${daySalt}`).digest('hex').slice(0, 32);
}

// ---------------------------------------------------------------------------
// GET /api/play/[userId]/[slug]/leaderboard?name=<board>&limit=<n>
// Returns top N scores for the named leaderboard.
// ---------------------------------------------------------------------------

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string; slug: string }> }
) {
  const limited = await rateLimitPublicRoute(req, 'leaderboard-get', 60, 60_000);
  if (limited) return limited;

  try {
    const { userId: clerkId, slug } = await params;
    const { searchParams } = new URL(req.url);
    const boardName = searchParams.get('name') ?? 'default';
    const limitParam = parseInt(searchParams.get('limit') ?? '10', 10);
    const limit = Math.min(Math.max(Number.isFinite(limitParam) ? limitParam : 10, 1), 100);

    const game = await resolvePublishedGame(clerkId, slug);
    if (!game) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    const [board] = await queryWithResilience(() => getDb()
      .select()
      .from(leaderboards)
      .where(and(eq(leaderboards.gameId, game.id), eq(leaderboards.name, boardName)))
      .limit(1));

    if (!board) {
      return NextResponse.json({ error: 'Leaderboard not found' }, { status: 404 });
    }

    const orderFn = board.sortOrder === 'asc' ? asc : desc;

    const entries = await queryWithResilience(() => getDb()
      .select({
        id: leaderboardEntries.id,
        playerName: leaderboardEntries.playerName,
        score: leaderboardEntries.score,
        metadata: leaderboardEntries.metadata,
        createdAt: leaderboardEntries.createdAt,
      })
      .from(leaderboardEntries)
      .where(eq(leaderboardEntries.leaderboardId, board.id))
      .orderBy(orderFn(leaderboardEntries.score))
      .limit(limit));

    const response = NextResponse.json({
      leaderboard: {
        name: board.name,
        sortOrder: board.sortOrder,
        maxEntries: board.maxEntries,
      },
      entries: entries.map((e, i) => ({
        rank: i + 1,
        playerName: e.playerName,
        score: e.score,
        metadata: e.metadata,
        createdAt: e.createdAt,
      })),
    });
    response.headers.set('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60');
    return response;
  } catch (error) {
    captureException(error, { route: '/api/play/[userId]/[slug]/leaderboard GET' });
    return NextResponse.json({ error: 'Failed to fetch leaderboard' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST /api/play/[userId]/[slug]/leaderboard
// Submit a score. Body: { name, playerName, score, metadata? }
// Rate limited: 10 submissions per minute per IP.
// ---------------------------------------------------------------------------

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string; slug: string }> }
) {
  // Stricter limit for score submission: 10 per minute per IP
  const limited = await rateLimitPublicRoute(req, 'leaderboard-post', 10, 60_000);
  if (limited) return limited;

  try {
    const { userId: clerkId, slug } = await params;

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    // Validate fields
    const boardName = typeof body.name === 'string' ? body.name.trim() : '';
    // Strip ASCII and Unicode angle brackets from playerName to prevent tag injection.
    // Unicode alternatives: single/double angle quotes, mathematical/CJK angle brackets.
    const rawPlayerName = typeof body.playerName === 'string' ? body.playerName.trim() : '';
    const playerName = rawPlayerName
      .replace(/[<>]/g, '')
      .replace(/[\u2039\u203A\u00AB\u00BB\u2329\u232A\u3008\u3009]/g, '');
    const score = typeof body.score === 'number' ? body.score : undefined;

    if (!boardName) {
      return NextResponse.json({ error: 'Missing required field: name' }, { status: 400 });
    }
    if (!playerName || playerName.length > 64) {
      return NextResponse.json(
        { error: 'playerName is required and must be 64 characters or fewer' },
        { status: 400 }
      );
    }
    if (score === undefined || !Number.isFinite(score)) {
      return NextResponse.json({ error: 'score must be a finite number' }, { status: 400 });
    }
    // Coerce to integer
    const scoreInt = Math.round(score);

    const game = await resolvePublishedGame(clerkId, slug);
    if (!game) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    const [board] = await queryWithResilience(() => getDb()
      .select()
      .from(leaderboards)
      .where(and(eq(leaderboards.gameId, game.id), eq(leaderboards.name, boardName)))
      .limit(1));

    if (!board) {
      return NextResponse.json({ error: 'Leaderboard not found' }, { status: 404 });
    }

    // Server-side score bounds check
    if (board.minScore !== null && scoreInt < board.minScore) {
      return NextResponse.json(
        { error: `Score out of range (min: ${board.minScore})` },
        { status: 400 }
      );
    }
    if (board.maxScore !== null && scoreInt > board.maxScore) {
      return NextResponse.json(
        { error: `Score out of range (max: ${board.maxScore})` },
        { status: 400 }
      );
    }

    // Duplicate detection: reject submissions from same IP hash within 1 second
    const ipHash = hashIp(getClientIp(req));
    const oneSecondAgo = new Date(Date.now() - 1000);

    // Validate metadata is a plain object if provided
    const metadata =
      body.metadata !== undefined &&
      body.metadata !== null &&
      typeof body.metadata === 'object' &&
      !Array.isArray(body.metadata)
        ? (body.metadata as Record<string, unknown>)
        : null;

    // PF-213: Atomic dedup + insert using a single SQL statement.
    // The CTE checks for recent submissions from the same IP and only
    // inserts if none exist, eliminating the TOCTOU race condition.
    const neonSql = getNeonSql();
    const result = await neonSql`
      WITH dedup AS (
        SELECT id FROM leaderboard_entries
        WHERE leaderboard_id = ${board.id}
          AND ip_hash = ${ipHash}
          AND created_at > ${oneSecondAgo.toISOString()}
        LIMIT 1
      )
      INSERT INTO leaderboard_entries (leaderboard_id, player_name, score, metadata, ip_hash)
      SELECT ${board.id}, ${playerName}, ${scoreInt}, ${metadata ? JSON.stringify(metadata) : null}::jsonb, ${ipHash}
      WHERE NOT EXISTS (SELECT 1 FROM dedup)
      RETURNING id, player_name, score, created_at
    `;

    if (result.length === 0) {
      return NextResponse.json(
        { error: 'Duplicate submission — please wait before submitting again' },
        { status: 429 }
      );
    }

    const entry = {
      id: result[0].id as string,
      playerName: result[0].player_name as string,
      score: result[0].score as number,
      createdAt: result[0].created_at as Date,
    };

    // Compute rank: how many entries have a strictly better score?
    // For desc boards: better = higher score. For asc boards: better = lower score.
    const betterScoreCondition =
      board.sortOrder === 'desc'
        ? gt(leaderboardEntries.score, scoreInt)
        : lt(leaderboardEntries.score, scoreInt);

    const [{ cnt: betterCount }] = await queryWithResilience(() => getDb()
      .select({ cnt: count() })
      .from(leaderboardEntries)
      .where(and(eq(leaderboardEntries.leaderboardId, board.id), betterScoreCondition)));

    const rank = Number(betterCount) + 1;

    // Prune entries beyond maxEntries (fire-and-forget)
    pruneLeaderboard(board.id, board.maxEntries, board.sortOrder).catch(() => {});

    return NextResponse.json({
      success: true,
      rank,
      entry: {
        id: entry.id,
        playerName: entry.playerName,
        score: entry.score,
        createdAt: entry.createdAt,
      },
    }, { status: 201 });
  } catch (error) {
    captureException(error, { route: '/api/play/[userId]/[slug]/leaderboard POST' });
    return NextResponse.json({ error: 'Failed to submit score' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// Background pruning — keeps board within maxEntries
// ---------------------------------------------------------------------------

async function pruneLeaderboard(
  boardId: string,
  maxEntries: number,
  sortOrder: 'asc' | 'desc'
): Promise<void> {
  const orderFn = sortOrder === 'asc' ? asc : desc;

  // Fetch all entry IDs ordered by rank (best first)
  const allEntries = await queryWithResilience(() => getDb()
    .select({ id: leaderboardEntries.id })
    .from(leaderboardEntries)
    .where(eq(leaderboardEntries.leaderboardId, boardId))
    .orderBy(orderFn(leaderboardEntries.score)));

  if (allEntries.length <= maxEntries) return;

  // Entries beyond maxEntries are the tail — delete them
  const toDelete = allEntries.slice(maxEntries);
  for (const { id } of toDelete) {
    await queryWithResilience(() => getDb().delete(leaderboardEntries).where(eq(leaderboardEntries.id, id)));
  }
}
