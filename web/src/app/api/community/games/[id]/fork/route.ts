import { NextRequest, NextResponse } from 'next/server';
import { getDb, queryWithResilience } from '@/lib/db/client';
import { publishedGames, projects, gameForks, users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { withApiMiddleware } from '@/lib/api/middleware';
import { captureException } from '@/lib/monitoring/sentry-server';
import { PROJECT_LIMITS } from '@/lib/projects/limits';

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const mid = await withApiMiddleware(req, {
      requireAuth: true,
      rateLimit: true,
      rateLimitConfig: { key: (id) => `fork:${id}`, max: 10, windowSeconds: 60 },
    });
    if (mid.error) return mid.error;

    const { id: gameId } = await params;

    // Fetch the published game
    const [game] = await queryWithResilience(() => getDb()
      .select()
      .from(publishedGames)
      .where(eq(publishedGames.id, gameId))
      .limit(1));

    if (!game) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    // Fetch the original project to get scene data
    const [originalProject] = await queryWithResilience(() => getDb()
      .select()
      .from(projects)
      .where(eq(projects.id, game.projectId))
      .limit(1));

    if (!originalProject) {
      return NextResponse.json(
        { error: 'Original project not found' },
        { status: 404 }
      );
    }

    // Check project limit for user's tier
    const [user] = await queryWithResilience(() => getDb()
      .select({ tier: users.tier })
      .from(users)
      .where(eq(users.id, mid.userId!))
      .limit(1));

    const userProjects = await queryWithResilience(() => getDb()
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.userId, mid.userId!)));

    // Fork limits cap pro at 999 (unlike PROJECT_LIMITS.pro = Infinity)
    // to keep the fork table manageable for community queries.
    const FORK_LIMITS: Record<string, number> = {
      starter: PROJECT_LIMITS.starter,
      hobbyist: PROJECT_LIMITS.hobbyist,
      creator: PROJECT_LIMITS.creator,
      pro: 999,
    };
    const tier = user?.tier ?? 'starter';
    const limit = FORK_LIMITS[tier] ?? FORK_LIMITS.starter;
    if (userProjects.length >= limit) {
      return NextResponse.json(
        { error: 'Project limit reached for your tier' },
        { status: 403 }
      );
    }

    // Create new project with forked data
    const [newProject] = await queryWithResilience(() => getDb()
      .insert(projects)
      .values({
        userId: mid.userId!,
        name: `${game.title} (Fork)`,
        sceneData: originalProject.sceneData,
        entityCount: originalProject.entityCount,
        formatVersion: originalProject.formatVersion,
      })
      .returning());

    // Record the fork
    await queryWithResilience(() => getDb().insert(gameForks).values({
      originalGameId: gameId,
      forkedProjectId: newProject.id,
      userId: mid.userId!,
    }));

    return NextResponse.json({ projectId: newProject.id }, { status: 201 });
  } catch (error) {
    captureException(error, { route: '/api/community/games/[id]/fork' });
    return NextResponse.json({ error: 'Failed to fork game' }, { status: 500 });
  }
}
