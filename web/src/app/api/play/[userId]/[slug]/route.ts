import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { publishedGames, projects, users } from '@/lib/db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { rateLimitPublicRoute } from '@/lib/rateLimit';
import { captureException } from '@/lib/monitoring/sentry-server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/play/[userId]/[slug]
 * Public route -- fetches published game data for the player page.
 * No authentication required (anyone with the link can play).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string; slug: string }> }
) {
  const limited = await rateLimitPublicRoute(req, 'play-game', 60, 5 * 60 * 1000);
  if (limited) return limited;

  try {
    const { userId: clerkId, slug } = await params;

    const db = getDb();

    // Look up the user by their Clerk ID
    const [user] = await db
      .select({ id: users.id, displayName: users.displayName })
      .from(users)
      .where(eq(users.clerkId, clerkId))
      .limit(1);

    if (!user) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    // Look up the published game by user ID + slug
    const [game] = await db
      .select()
      .from(publishedGames)
      .where(
        and(
          eq(publishedGames.userId, user.id),
          eq(publishedGames.slug, slug)
        )
      )
      .limit(1);

    if (!game) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    if (game.status !== 'published') {
      return NextResponse.json(
        { error: 'This game is not currently published' },
        { status: 404 }
      );
    }

    // Fetch the project scene data
    const [project] = await db
      .select({ sceneData: projects.sceneData })
      .from(projects)
      .where(eq(projects.id, game.projectId))
      .limit(1);

    if (!project) {
      return NextResponse.json(
        { error: 'Game data not found' },
        { status: 404 }
      );
    }

    // Increment play count (fire-and-forget)
    db.update(publishedGames)
      .set({ playCount: sql`${publishedGames.playCount} + 1` })
      .where(eq(publishedGames.id, game.id))
      .then(() => {})
      .catch(() => {});

    const response = NextResponse.json({
      game: {
        id: game.id,
        title: game.title,
        description: game.description,
        slug: game.slug,
        version: game.version,
        creatorName: user.displayName || 'Unknown Creator',
        sceneData: project.sceneData,
      },
    });
    // Short TTL: game data changes when creators republish; stale-while-revalidate
    // lets the CDN serve fresh data without blocking the player.
    response.headers.set('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=120');
    return response;
  } catch (error) {
    captureException(error, { route: '/api/play/[userId]/[slug]' });
    return NextResponse.json(
      { error: 'Failed to load game' },
      { status: 500 }
    );
  }
}
