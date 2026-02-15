import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { publishedGames, projects, gameForks, users } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { authenticateRequest } from '@/lib/auth/api-auth';

export const dynamic = 'force-dynamic';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const db = getDb();
    const authResult = await authenticateRequest();
    if (!authResult.ok) return authResult.response;

    const { id: gameId } = await params;

    // Fetch the published game
    const [game] = await db
      .select()
      .from(publishedGames)
      .where(eq(publishedGames.id, gameId))
      .limit(1);

    if (!game) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    // Fetch the original project to get scene data
    const [originalProject] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, game.projectId))
      .limit(1);

    if (!originalProject) {
      return NextResponse.json(
        { error: 'Original project not found' },
        { status: 404 }
      );
    }

    // Check project limit for user's tier
    const [user] = await db
      .select({ tier: users.tier })
      .from(users)
      .where(eq(users.id, authResult.ctx.user.id))
      .limit(1);

    const userProjects = await db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.userId, authResult.ctx.user.id));

    const tierLimits: Record<string, number> = {
      starter: 3,
      hobbyist: 10,
      creator: 50,
      pro: 999,
    };

    const limit = tierLimits[user?.tier || 'starter'];
    if (userProjects.length >= limit) {
      return NextResponse.json(
        { error: 'Project limit reached for your tier' },
        { status: 403 }
      );
    }

    // Create new project with forked data
    const [newProject] = await db
      .insert(projects)
      .values({
        userId: authResult.ctx.user.id,
        name: `${game.title} (Fork)`,
        sceneData: originalProject.sceneData,
        entityCount: originalProject.entityCount,
        formatVersion: originalProject.formatVersion,
      })
      .returning();

    // Record the fork
    await db.insert(gameForks).values({
      originalGameId: gameId,
      forkedProjectId: newProject.id,
      userId: authResult.ctx.user.id,
    });

    return NextResponse.json({ projectId: newProject.id }, { status: 201 });
  } catch (error) {
    console.error('Failed to fork game:', error);
    return NextResponse.json({ error: 'Failed to fork game' }, { status: 500 });
  }
}
