import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withApiMiddleware } from '@/lib/api/middleware';
import { getDb, queryWithResilience } from '@/lib/db/client';
import { publishedGames, projects, gameTags } from '@/lib/db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { moderateContent } from '@/lib/moderation/contentFilter';
import { logger } from '@/lib/logging/logger';
import { extractRequestId } from '@/lib/logging/requestContext';
import { captureException } from '@/lib/monitoring/sentry-server';

const publishSchema = z.object({
  projectId: z.string().min(1).max(100),
  title: z.string().min(1).max(200),
  slug: z.string().min(3).max(50),
  description: z.string().max(5000).optional(),
  // thumbnail/tags are intentionally lenient — non-string thumbnails and
  // non-array tags are silently ignored (not rejected) to match legacy behavior.
  thumbnail: z.unknown().optional(),
  tags: z.unknown().optional(),
});

export async function POST(request: NextRequest) {
  try {
  const requestId = extractRequestId(request.headers);
  const reqLog = logger.child({ requestId, endpoint: 'POST /api/publish' });

  const mid = await withApiMiddleware(request, {
    requireAuth: true,
    rateLimit: true,
    rateLimitConfig: { key: (id) => `publish:${id}`, max: 10, windowSeconds: 60 },
    validate: publishSchema,
  });
  if (mid.error) return mid.error;
  const { user, clerkId } = mid.authContext!;
  const body = mid.body as z.infer<typeof publishSchema>;
  const { projectId, title, slug } = body;
  const description = body.description ?? null;

  const reqLogAuth = reqLog.child({ userId: user.id });

  // Thumbnail is an optional base64 data URL (max 200 KB to prevent abuse).
  // Only safe raster MIME types allowed — SVG excluded to prevent XSS.
  const ALLOWED_THUMBNAIL_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
  const thumbnailRaw = body.thumbnail;
  let thumbnail: string | null = null;
  if (typeof thumbnailRaw === 'string' && thumbnailRaw.startsWith('data:image/')) {
    const mimeMatch = thumbnailRaw.match(/^data:(image\/[^;,]+)/);
    const mime = mimeMatch ? mimeMatch[1] : null;
    if (!mime || !ALLOWED_THUMBNAIL_TYPES.includes(mime)) {
      return NextResponse.json(
        { error: `Unsupported thumbnail type. Allowed: ${ALLOWED_THUMBNAIL_TYPES.join(', ')}` },
        { status: 422 },
      );
    }
    const MAX_THUMBNAIL_BYTES = 200 * 1024;
    if (thumbnailRaw.length <= MAX_THUMBNAIL_BYTES) {
      thumbnail = thumbnailRaw;
    }
  }

  // Content moderation check on title and description
  const titleMod = moderateContent(title);
  if (titleMod.severity === 'block') {
    reqLogAuth.warn('Publish blocked: prohibited title content', { slug });
    return NextResponse.json(
      { error: 'Game title contains prohibited content' },
      { status: 422 }
    );
  }
  if (description) {
    const descMod = moderateContent(description);
    if (descMod.severity === 'block') {
      reqLogAuth.warn('Publish blocked: prohibited description content', { slug });
      return NextResponse.json(
        { error: 'Game description contains prohibited content' },
        { status: 422 }
      );
    }
  }

  // Validate slug format
  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(slug)) {
    return NextResponse.json({ error: 'Invalid slug format' }, { status: 400 });
  }

  // Block reserved words that could collide with platform routes
  const RESERVED_SLUGS = [
    'admin', 'api', 'auth', 'webhook', 'webhooks',
    'play', 'dev', 'login', 'logout', 'signup', 'sign-up', 'sign-in',
    'settings', 'account', 'billing', 'dashboard', 'help', 'support',
    'status', 'health', 'internal', 'system', 'static', 'assets', 'public',
  ];
  if (RESERVED_SLUGS.includes(slug)) {
    return NextResponse.json(
      { error: `Slug "${slug}" is reserved and cannot be used` },
      { status: 400 },
    );
  }

  // Check tier publish limits
  const tierLimits: Record<string, number> = { starter: 1, hobbyist: 3, creator: 10, pro: 100 };
  const maxPublished = tierLimits[user.tier] ?? 1;
  const existingPublished = await queryWithResilience(() => getDb().select({ id: publishedGames.id })
    .from(publishedGames)
    .where(and(eq(publishedGames.userId, user.id), eq(publishedGames.status, 'published'))));

  if (existingPublished.length >= maxPublished) {
    reqLogAuth.warn('Publish limit reached', { tier: user.tier, maxPublished });
    return NextResponse.json({ error: `Publish limit reached (${maxPublished} for ${user.tier} tier)` }, { status: 403 });
  }

  // Check slug availability (for this user)
  const existingSlug = await queryWithResilience(() => getDb().select({ id: publishedGames.id, version: publishedGames.version })
    .from(publishedGames)
    .where(and(eq(publishedGames.userId, user.id), eq(publishedGames.slug, slug)))
    .limit(1));

  // Get project data (verify ownership)
  const [project] = await queryWithResilience(() => getDb().select().from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, user.id)))
    .limit(1));
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 });

  const gameUrl = `/play/${clerkId}/${slug}`;

  // Validate tags — lenient filter: non-array becomes [], non-string entries dropped
  const validTags: string[] = Array.isArray(body.tags)
    ? (body.tags as unknown[])
        .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
        .map((t) => t.trim().toLowerCase().slice(0, 30))
        .slice(0, 5)
    : [];

  if (existingSlug.length > 0) {
    // Update existing publication (republish)
    const gameDbId = existingSlug[0].id;
    const newVersion = existingSlug[0].version + 1;
    await queryWithResilience(() => getDb().update(publishedGames)
      .set({
        title: title,
        description: description ?? null,
        status: 'published',
        version: newVersion,
        cdnUrl: gameUrl,
        thumbnail,
        updatedAt: new Date(),
      })
      .where(eq(publishedGames.id, gameDbId)));

    // Replace tags
    await queryWithResilience(() => getDb().delete(gameTags).where(eq(gameTags.gameId, gameDbId)));
    if (validTags.length > 0) {
      await queryWithResilience(() => getDb().insert(gameTags).values(
        validTags.map((tag) => ({ gameId: gameDbId, tag }))
      ));
    }

    reqLogAuth.info('Game republished', {
      projectId: projectId,
      slug: slug,
      version: newVersion,
    });

    const [updated] = await queryWithResilience(() => getDb().select().from(publishedGames).where(eq(publishedGames.id, gameDbId)));
    return NextResponse.json({ publication: { ...updated, url: gameUrl } });
  }

  // Create new publication — use onConflictDoUpdate to handle concurrent
  // publishes with the same slug atomically (PF-212: TOCTOU fix).
  // The unique index uq_published_games_slug(userId, slug) prevents duplicates.
  const [publication] = await queryWithResilience(() => getDb().insert(publishedGames)
    .values({
      userId: user.id,
      projectId: projectId,
      slug: slug,
      title: title,
      description: description ?? null,
      status: 'published',
      cdnUrl: gameUrl,
      thumbnail,
    })
    .onConflictDoUpdate({
      target: [publishedGames.userId, publishedGames.slug],
      set: {
        projectId: projectId,
        title: title,
        description: description ?? null,
        status: 'published',
        cdnUrl: gameUrl,
        thumbnail,
        version: sql`${publishedGames.version} + 1`,
        updatedAt: new Date(),
      },
    })
    .returning());

  // Replace tags atomically — delete old tags first to prevent duplicates
  // on concurrent publishes hitting the ON CONFLICT DO UPDATE path.
  await queryWithResilience(() => getDb().delete(gameTags).where(eq(gameTags.gameId, publication.id)));
  if (validTags.length > 0) {
    await queryWithResilience(() => getDb().insert(gameTags).values(
      validTags.map((tag) => ({ gameId: publication.id, tag }))
    ));
  }

  reqLogAuth.info('Game published', {
    projectId: projectId,
    slug: slug,
    version: 1,
  });

  return NextResponse.json({ publication: { ...publication, url: gameUrl } });
  } catch (err) {
    captureException(err, { route: '/api/publish', method: 'POST' });
    return NextResponse.json({ error: 'Failed to publish game' }, { status: 500 });
  }
}

