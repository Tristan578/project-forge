import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getDb } from '@/lib/db/client';
import { publishedGames, users, projects } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';

export async function POST(request: NextRequest) {
  const { userId: clerkId } = await auth();
  if (!clerkId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const { projectId, title, slug, description } = body;

  if (!projectId || !title || !slug) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  // Validate slug format
  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(slug) || slug.length < 3 || slug.length > 50) {
    return NextResponse.json({ error: 'Invalid slug format' }, { status: 400 });
  }

  const db = getDb();

  // Get user
  const [user] = await db.select().from(users).where(eq(users.clerkId, clerkId)).limit(1);
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  // Check tier publish limits
  const tierLimits: Record<string, number> = { starter: 1, hobbyist: 3, creator: 10, pro: 100 };
  const maxPublished = tierLimits[user.tier] ?? 1;
  const existingPublished = await db.select({ id: publishedGames.id })
    .from(publishedGames)
    .where(and(eq(publishedGames.userId, user.id), eq(publishedGames.status, 'published')));

  if (existingPublished.length >= maxPublished) {
    return NextResponse.json({ error: `Publish limit reached (${maxPublished} for ${user.tier} tier)` }, { status: 403 });
  }

  // Check slug availability (for this user)
  const existingSlug = await db.select({ id: publishedGames.id, version: publishedGames.version })
    .from(publishedGames)
    .where(and(eq(publishedGames.userId, user.id), eq(publishedGames.slug, slug)))
    .limit(1);

  // Get project data
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  const gameUrl = `/play/${clerkId}/${slug}`;

  if (existingSlug.length > 0) {
    // Update existing publication (republish)
    const newVersion = existingSlug[0].version + 1;
    await db.update(publishedGames)
      .set({
        title,
        description: description || null,
        status: 'published',
        version: newVersion,
        cdnUrl: gameUrl,
        updatedAt: new Date(),
      })
      .where(eq(publishedGames.id, existingSlug[0].id));

    const [updated] = await db.select().from(publishedGames).where(eq(publishedGames.id, existingSlug[0].id));
    return NextResponse.json({ publication: { ...updated, url: gameUrl } });
  }

  // Create new publication
  const [publication] = await db.insert(publishedGames)
    .values({
      userId: user.id,
      projectId,
      slug,
      title,
      description: description || null,
      status: 'published',
      cdnUrl: gameUrl,
    })
    .returning();

  return NextResponse.json({ publication: { ...publication, url: gameUrl } });
}
