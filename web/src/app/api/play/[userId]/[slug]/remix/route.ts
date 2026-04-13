import { NextRequest, NextResponse } from 'next/server';
import { getDb, queryWithResilience } from '@/lib/db/client';
import { publishedGames, projects, users, gameForks } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { safeAuth } from '@/lib/auth/safe-auth';
import { createProject } from '@/lib/projects/service';
import { rateLimitPublicRoute } from '@/lib/rateLimit';
import { captureException } from '@/lib/monitoring/sentry-server';

export const dynamic = 'force-dynamic';

/**
 * POST /api/play/[userId]/[slug]/remix
 * Clone a published game's scene data into the authenticated user's project list.
 * Records the fork in the gameForks table for attribution.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string; slug: string }> }
) {
  const limited = await rateLimitPublicRoute(req, 'remix-game', 10, 5 * 60 * 1000);
  if (limited) return limited;

  try {
    // Auth gate — must be signed in to remix
    const { userId: remixerClerkId } = await safeAuth();
    if (!remixerClerkId) {
      return NextResponse.json(
        { error: 'Sign in to remix this game' },
        { status: 401 }
      );
    }

    const { userId: creatorClerkId, slug } = await params;

    // Look up the remixer's internal user ID
    const [remixer] = await queryWithResilience(() =>
      getDb()
        .select({ id: users.id })
        .from(users)
        .where(eq(users.clerkId, remixerClerkId))
        .limit(1)
    );

    if (!remixer) {
      return NextResponse.json(
        { error: 'User account not found' },
        { status: 404 }
      );
    }

    // Look up the creator
    const [creator] = await queryWithResilience(() =>
      getDb()
        .select({ id: users.id })
        .from(users)
        .where(eq(users.clerkId, creatorClerkId))
        .limit(1)
    );

    if (!creator) {
      return NextResponse.json(
        { error: 'Game not found' },
        { status: 404 }
      );
    }

    // Look up the published game
    const [game] = await queryWithResilience(() =>
      getDb()
        .select({
          id: publishedGames.id,
          title: publishedGames.title,
          projectId: publishedGames.projectId,
        })
        .from(publishedGames)
        .where(
          and(
            eq(publishedGames.userId, creator.id),
            eq(publishedGames.slug, slug)
          )
        )
        .limit(1)
    );

    if (!game) {
      return NextResponse.json(
        { error: 'Game not found' },
        { status: 404 }
      );
    }

    // Fetch the original project's scene data
    const [sourceProject] = await queryWithResilience(() =>
      getDb()
        .select({ sceneData: projects.sceneData })
        .from(projects)
        .where(eq(projects.id, game.projectId))
        .limit(1)
    );

    if (!sourceProject) {
      return NextResponse.json(
        { error: 'Game data not found' },
        { status: 404 }
      );
    }

    // Create the remixed project (respects tier-based project limits)
    const remixedProject = await createProject(
      remixer.id,
      `${game.title} (Remix)`,
      sourceProject.sceneData
    );

    // Record the fork for attribution (fire-and-forget)
    queryWithResilience(() =>
      getDb()
        .insert(gameForks)
        .values({
          originalGameId: game.id,
          forkedProjectId: remixedProject.id,
          userId: remixer.id,
        })
        .returning()
    ).catch(() => {});

    return NextResponse.json(
      { projectId: remixedProject.id, name: remixedProject.name },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof Error && error.message === 'Project limit exceeded') {
      return NextResponse.json(
        { error: 'Project limit reached — upgrade your plan to remix more games' },
        { status: 403 }
      );
    }
    captureException(error, { route: '/api/play/[userId]/[slug]/remix' });
    return NextResponse.json(
      { error: 'Failed to remix game' },
      { status: 500 }
    );
  }
}
