import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { featuredGames, publishedGames, users } from '@/lib/db/schema';
import { eq, sql } from 'drizzle-orm';
import { authenticateRequest, assertAdmin } from '@/lib/auth/api-auth';

export const dynamic = 'force-dynamic';

// GET: List currently featured games (admin)
export async function GET() {
  try {
    const authResult = await authenticateRequest();
    if (!authResult.ok) return authResult.response;

    const adminError = assertAdmin(authResult.ctx.clerkId);
    if (adminError) return adminError;

    const db = getDb();

    const featured = await db
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
      .orderBy(featuredGames.position);

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
    const authResult = await authenticateRequest();
    if (!authResult.ok) return authResult.response;

    const adminError = assertAdmin(authResult.ctx.clerkId);
    if (adminError) return adminError;

    const body = await req.json();
    const { gameId, position, expiresAt } = body;

    if (!gameId || typeof gameId !== 'string') {
      return NextResponse.json({ error: 'gameId is required' }, { status: 400 });
    }

    const db = getDb();

    // Verify game exists and is published
    const [game] = await db
      .select({ id: publishedGames.id })
      .from(publishedGames)
      .where(eq(publishedGames.id, gameId))
      .limit(1);

    if (!game) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    // Check max featured limit (5)
    const currentCount = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(featuredGames);

    if (Number(currentCount[0].count) >= 5) {
      return NextResponse.json(
        { error: 'Maximum 5 featured games allowed. Remove one first.' },
        { status: 409 }
      );
    }

    const [entry] = await db
      .insert(featuredGames)
      .values({
        gameId,
        position: typeof position === 'number' ? position : 0,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
      })
      .returning();

    return NextResponse.json({ featured: entry }, { status: 201 });
  } catch (error) {
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
    const authResult = await authenticateRequest();
    if (!authResult.ok) return authResult.response;

    const adminError = assertAdmin(authResult.ctx.clerkId);
    if (adminError) return adminError;

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'id query param required' }, { status: 400 });
    }

    const db = getDb();

    await db.delete(featuredGames).where(eq(featuredGames.id, id));

    return NextResponse.json({ removed: true });
  } catch (error) {
    console.error('Failed to unfeature game:', error);
    return NextResponse.json(
      { error: 'Failed to unfeature game' },
      { status: 500 }
    );
  }
}
