import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb, queryWithResilience } from '@/lib/db/client';
import { featuredGames, publishedGames, users } from '@/lib/db/schema';
import { eq, sql } from 'drizzle-orm';
import { assertAdmin } from '@/lib/auth/api-auth';
import { withApiMiddleware } from '@/lib/api/middleware';
import { rateLimitAdminRoute } from '@/lib/rateLimit';
import { captureException } from '@/lib/monitoring/sentry-server';

export const dynamic = 'force-dynamic';

const featureGameSchema = z.object({
  gameId: z.string().min(1).max(100),
  position: z.number().int().min(0).max(100).optional(),
  expiresAt: z.string().datetime().optional().nullable(),
});

// GET: List currently featured games (admin)
export async function GET(req: NextRequest) {
  try {
    const mid = await withApiMiddleware(req, { requireAuth: true });
    if (mid.error) return mid.error;

    const adminError = assertAdmin(mid.authContext!.clerkId);
    if (adminError) return adminError;

    const rateLimitError = await rateLimitAdminRoute(mid.userId!, 'admin-featured');
    if (rateLimitError) return rateLimitError;

    const featured = await queryWithResilience(() =>
      getDb()
        .select({
          id: featuredGames.id,
          gameId: featuredGames.gameId,
          position: featuredGames.position,
          featuredAt: featuredGames.featuredAt,
          expiresAt: featuredGames.expiresAt,
          gameTitle: publishedGames.title,
          gameSlug: publishedGames.slug,
          authorName: users.displayName,
        })
        .from(featuredGames)
        .leftJoin(publishedGames, eq(featuredGames.gameId, publishedGames.id))
        .leftJoin(users, eq(publishedGames.userId, users.id))
        .orderBy(featuredGames.position)
    );

    return NextResponse.json({
      featured: featured.map((f) => ({
        id: f.id,
        gameId: f.gameId,
        position: f.position,
        featuredAt: f.featuredAt?.toISOString(),
        expiresAt: f.expiresAt?.toISOString() ?? null,
        gameTitle: f.gameTitle ?? 'Unknown',
        gameSlug: f.gameSlug ?? '',
        authorName: f.authorName ?? 'Unknown',
      })),
    });
  } catch (error) {
    captureException(error, { route: '/api/admin/featured', method: 'GET' });
    console.error('Failed to fetch featured games:', error);
    return NextResponse.json(
      { error: 'Failed to fetch featured games' },
      { status: 500 }
    );
  }
}

// POST: Feature a game (admin)
export async function POST(req: NextRequest) {
  try {
    const mid = await withApiMiddleware(req, { requireAuth: true });
    if (mid.error) return mid.error;

    const adminError = assertAdmin(mid.authContext!.clerkId);
    if (adminError) return adminError;

    const rateLimitError = await rateLimitAdminRoute(mid.userId!, 'admin-featured');
    if (rateLimitError) return rateLimitError;

    const parsed = featureGameSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', issues: parsed.error.issues },
        { status: 400 }
      );
    }
    const { gameId, position, expiresAt } = parsed.data;

    // Verify game exists and is published
    const [game] = await queryWithResilience(() =>
      getDb()
        .select({ id: publishedGames.id })
        .from(publishedGames)
        .where(eq(publishedGames.id, gameId))
        .limit(1)
    );

    if (!game) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    // Check max featured limit (5)
    const currentCount = await queryWithResilience(() =>
      getDb()
        .select({ count: sql<number>`COUNT(*)` })
        .from(featuredGames)
    );

    if (Number(currentCount[0].count) >= 5) {
      return NextResponse.json(
        { error: 'Maximum 5 featured games allowed. Remove one first.' },
        { status: 409 }
      );
    }

    const [entry] = await queryWithResilience(() =>
      getDb()
        .insert(featuredGames)
        .values({
          gameId,
          position: typeof position === 'number' ? position : 0,
          expiresAt: expiresAt ? new Date(expiresAt) : null,
        })
        .returning()
    );

    return NextResponse.json({ featured: entry }, { status: 201 });
  } catch (error) {
    captureException(error, { route: '/api/admin/featured', method: 'POST' });
    console.error('Failed to feature game:', error);
    return NextResponse.json(
      { error: 'Failed to feature game' },
      { status: 500 }
    );
  }
}

// DELETE: Unfeature a game (admin)
export async function DELETE(req: NextRequest) {
  try {
    const mid = await withApiMiddleware(req, { requireAuth: true });
    if (mid.error) return mid.error;

    const adminError = assertAdmin(mid.authContext!.clerkId);
    if (adminError) return adminError;

    const rateLimitError = await rateLimitAdminRoute(mid.userId!, 'admin-featured');
    if (rateLimitError) return rateLimitError;

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'id query param required' }, { status: 400 });
    }

    await queryWithResilience(() =>
      getDb().delete(featuredGames).where(eq(featuredGames.id, id))
    );

    return NextResponse.json({ removed: true });
  } catch (error) {
    captureException(error, { route: '/api/admin/featured', method: 'DELETE' });
    console.error('Failed to unfeature game:', error);
    return NextResponse.json(
      { error: 'Failed to unfeature game' },
      { status: 500 }
    );
  }
}
