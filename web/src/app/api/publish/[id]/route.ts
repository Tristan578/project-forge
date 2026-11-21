import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/lib/api/middleware';
import { getDb, queryWithResilience } from '@/lib/db/client';
import { publishedGames } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { captureException } from '@/lib/monitoring/sentry-server';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const mid = await withApiMiddleware(request, {
    requireAuth: true,
    rateLimit: true,
    rateLimitConfig: { key: (userId) => `user:publish-delete:${userId}`, max: 10, windowSeconds: 60 },
  });
  if (mid.error) return mid.error;

  const { id } = await params;

  try {
    await queryWithResilience(() => getDb().update(publishedGames)
      .set({ status: 'unpublished', updatedAt: new Date() })
      .where(and(eq(publishedGames.id, id), eq(publishedGames.userId, mid.userId!))));

    return NextResponse.json({ success: true });
  } catch (err) {
    captureException(err, { route: '/api/publish/[id]', method: 'DELETE', id });
    return NextResponse.json({ error: 'Failed to unpublish game' }, { status: 500 });
  }
}
