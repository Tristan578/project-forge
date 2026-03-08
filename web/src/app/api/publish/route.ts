import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { getDb } from '@/lib/db/client';
import { publishedGames, projects, gameTags } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { rateLimit, rateLimitResponse } from '@/lib/rateLimit';
import { moderateContent } from '@/lib/moderation/contentFilter';
import { parseJsonBody, requireString, optionalString } from '@/lib/apiValidation';

export async function POST(request: NextRequest) {
  const authResult = await authenticateRequest();
  if (!authResult.ok) return authResult.response;
  const { user, clerkId } = authResult.ctx;

  // Rate limit: 10 publish requests per minute per user
  const rl = rateLimit(`publish:${clerkId}`, 10, 60_000);
  if (!rl.allowed) return rateLimitResponse(rl.remaining, rl.resetAt);

  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed.response;

  const projectIdResult = requireString(parsed.body.projectId, 'Project ID', { maxLength: 100 });
  if (!projectIdResult.ok) return projectIdResult.response;

  const titleResult = requireString(parsed.body.title, 'Title', { maxLength: 200 });
  if (!titleResult.ok) return titleResult.response;

  const slugResult = requireString(parsed.body.slug, 'Slug', { minLength: 3, maxLength: 50 });
  if (!slugResult.ok) return slugResult.response;

  const descResult = optionalString(parsed.body.description, 'Description', { maxLength: 5000 });
  if (!descResult.ok) return descResult.response;

  // Content moderation check on title and description
  const titleMod = moderateContent(titleResult.value);
  if (titleMod.severity === 'block') {
    return NextResponse.json(
      { error: 'Game title contains prohibited content' },
      { status: 422 }
    );
  }
  if (descResult.value) {
    const descMod = moderateContent(descResult.value);
    if (descMod.severity === 'block') {
      return NextResponse.json(
        { error: 'Game description contains prohibited content' },
        { status: 422 }
      );
    }
  }

  // Validate slug format
  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(slugResult.value)) {
    return NextResponse.json({ error: 'Invalid slug format' }, { status: 400 });
  }

  const db = getDb();

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
    .where(and(eq(publishedGames.userId, user.id), eq(publishedGames.slug, slugResult.value)))
    .limit(1);

  // Get project data (verify ownership)
  const [project] = await db.select().from(projects)
    .where(and(eq(projects.id, projectIdResult.value), eq(projects.userId, user.id)))
    .limit(1);
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  const gameUrl = `/play/${clerkId}/${slugResult.value}`;

  // Validate tags
  const validTags: string[] = Array.isArray(parsed.body.tags)
    ? (parsed.body.tags as unknown[]).filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
        .map((t) => t.trim().toLowerCase().slice(0, 30))
        .slice(0, 5)
    : [];

  if (existingSlug.length > 0) {
    // Update existing publication (republish)
    const gameDbId = existingSlug[0].id;
    const newVersion = existingSlug[0].version + 1;
    await db.update(publishedGames)
      .set({
        title: titleResult.value,
        description: descResult.value ?? null,
        status: 'published',
        version: newVersion,
        cdnUrl: gameUrl,
        updatedAt: new Date(),
      })
      .where(eq(publishedGames.id, gameDbId));

    // Replace tags
    await db.delete(gameTags).where(eq(gameTags.gameId, gameDbId));
    if (validTags.length > 0) {
      await db.insert(gameTags).values(
        validTags.map((tag) => ({ gameId: gameDbId, tag }))
      );
    }

    const [updated] = await db.select().from(publishedGames).where(eq(publishedGames.id, gameDbId));
    return NextResponse.json({ publication: { ...updated, url: gameUrl } });
  }

  // Create new publication
  const [publication] = await db.insert(publishedGames)
    .values({
      userId: user.id,
      projectId: projectIdResult.value,
      slug: slugResult.value,
      title: titleResult.value,
      description: descResult.value ?? null,
      status: 'published',
      cdnUrl: gameUrl,
    })
    .returning();

  // Insert tags
  if (validTags.length > 0) {
    await db.insert(gameTags).values(
      validTags.map((tag) => ({ gameId: publication.id, tag }))
    );
  }

  return NextResponse.json({ publication: { ...publication, url: gameUrl } });
}
