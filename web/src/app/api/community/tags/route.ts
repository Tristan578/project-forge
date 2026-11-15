import { NextRequest, NextResponse } from 'next/server';
import { getDb, queryWithResilience } from '@/lib/db/client';
import { gameTags } from '@/lib/db/schema';
import { sql } from 'drizzle-orm';
import { rateLimitPublicRoute } from '@/lib/rateLimit';
import { captureException } from '@/lib/monitoring/sentry-server';
import { redactedJson } from '@/lib/api/errors';
import { withEgressGuard } from '@/lib/security/egressGuard';

export const dynamic = 'force-dynamic';

async function GET_impl(req: NextRequest) {
  const limited = await rateLimitPublicRoute(req, 'community-tags', 30, 60_000);
  if (limited) return limited;
  try {
    // Get top 20 tags by frequency
    const tags = await queryWithResilience(() => getDb()
      .select({
        tag: gameTags.tag,
        count: sql<number>`COUNT(*)`,
      })
      .from(gameTags)
      .groupBy(gameTags.tag)
      .orderBy(sql`COUNT(*) DESC`)
      .limit(20));

    const response = NextResponse.json({
      tags: tags.map((t: { tag: string; count: number }) => ({
        tag: t.tag,
        count: Number(t.count),
      })),
    });
    response.headers.set('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    return response;
  } catch (error) {
    console.error('Failed to fetch tags:', error);
    captureException(error, { route: '/api/community/tags' });
    return redactedJson({ error: 'Failed to fetch tags' }, { status: 500 });
  }
}

// Egress guard (#9736): every response this route returns leaves through the
// one redaction chokepoint. See `src/lib/security/egressGuard.ts`.
export const GET = withEgressGuard(GET_impl);
