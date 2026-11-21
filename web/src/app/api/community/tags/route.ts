import { NextRequest, NextResponse } from 'next/server';
import { getDb, queryWithResilience } from '@/lib/db/client';
import { gameTags } from '@/lib/db/schema';
import { sql } from 'drizzle-orm';
import { rateLimitPublicRoute } from '@/lib/rateLimit';
import { captureException } from '@/lib/monitoring/sentry-server';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
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
    return NextResponse.json({ error: 'Failed to fetch tags' }, { status: 500 });
  }
}
