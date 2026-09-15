import { NextRequest, NextResponse } from 'next/server';
import { getDb, queryWithResilience } from '@/lib/db/client';
import { publishedGames, projects, users } from '@/lib/db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { rateLimitPublicRoute } from '@/lib/rateLimit';
import { captureException } from '@/lib/monitoring/sentry-server';
import { redactedJson } from '@/lib/api/errors';
import { withEgressGuard } from '@/lib/security/egressGuard';
import { extractRequestId } from '@/lib/logging/requestContext';
import { isPublishToR2Enabled } from '@/lib/config/assetStorage';
import { readPublishedGameBundle } from '@/lib/storage/publishedGameStorage';

export const dynamic = 'force-dynamic';

/**
 * GET /api/play/[userId]/[slug]
 * Public route -- fetches published game data for the player page.
 * No authentication required (anyone with the link can play).
 */
async function GET_impl(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string; slug: string }> }
) {
  const limited = await rateLimitPublicRoute(req, 'play-game', 60, 5 * 60 * 1000);
  if (limited) return limited;

  try {
    const requestId = extractRequestId(req.headers);
    const { userId: clerkId, slug } = await params;

    // Look up the user by their Clerk ID
    const [user] = await queryWithResilience(() => getDb()
      .select({ id: users.id, displayName: users.displayName })
      .from(users)
      .where(eq(users.clerkId, clerkId))
      .limit(1));

    if (!user) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    // Look up the published game by user ID + slug
    const [game] = await queryWithResilience(() => getDb()
      .select()
      .from(publishedGames)
      .where(
        and(
          eq(publishedGames.userId, user.id),
          eq(publishedGames.slug, slug)
        )
      )
      .limit(1));

    if (!game) {
      return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    }

    if (game.status !== 'published') {
      return NextResponse.json(
        { error: 'This game is not currently published' },
        { status: 404 }
      );
    }

    // Resolve the scene data. When this game was mirrored to R2 on publish
    // (cdn_bundle_key set) and the mirror is enabled, read the bundle from
    // object storage FIRST — that is the CDN-backed fast path (#7580). The read
    // is keyed by the DB row's OWN version (games/{userId}/{slug}/v{version}/…),
    // so it can only fetch the object matching the version the database claims:
    // a bundle from a later, uncommitted, or failed republish lives at a
    // different key and is invisible here, and readPublishedGameBundle also
    // re-checks the manifest against version/slug/userId. Any read failure
    // (missing object, transport error, malformed JSON, or a stale/mismatched
    // bundle) is logged to Sentry and falls through to the Postgres-served
    // sceneData, which remains the source of truth. The remix path is
    // deliberately untouched: it still reads projects.sceneData directly and
    // quarantines scripts.
    let sceneData: unknown;
    let servedFromR2 = false;

    if (game.cdnBundleKey && isPublishToR2Enabled()) {
      try {
        const bundle = await readPublishedGameBundle(clerkId, slug, game.version);
        sceneData = bundle.sceneData;
        servedFromR2 = true;
      } catch (err) {
        captureException(err, {
          route: '/api/play/[userId]/[slug]',
          stage: 'r2-bundle-read',
          requestId,
          userId: clerkId,
          slug,
        });
      }
    }

    if (!servedFromR2) {
      // Fetch the project scene data (Postgres fallback / default path)
      const [project] = await queryWithResilience(() => getDb()
        .select({ sceneData: projects.sceneData })
        .from(projects)
        .where(eq(projects.id, game.projectId))
        .limit(1));

      if (!project) {
        return NextResponse.json(
          { error: 'Game data not found' },
          { status: 404 }
        );
      }
      sceneData = project.sceneData;
    }

    // Increment play count (fire-and-forget)
    queryWithResilience(() => getDb().update(publishedGames)
      .set({ playCount: sql`${publishedGames.playCount} + 1` })
      .where(eq(publishedGames.id, game.id)))
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
        sceneData,
      },
    });
    // Short TTL: game data changes when creators republish; stale-while-revalidate
    // lets the CDN serve fresh data without blocking the player.
    response.headers.set('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=120');
    return response;
  } catch (error) {
    captureException(error, { route: '/api/play/[userId]/[slug]' });
    return redactedJson(
      { error: 'Failed to load game' },
      { status: 500 }
    );
  }
}

// Egress guard (#9736): every response this route returns leaves through the
// one redaction chokepoint. See `src/lib/security/egressGuard.ts`.
export const GET = withEgressGuard(GET_impl);
