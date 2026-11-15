import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/lib/api/middleware';
import { getDb, queryWithResilience } from '@/lib/db/client';
import { publishedGames } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { captureException } from '@/lib/monitoring/sentry-server';
import { redactedJson } from '@/lib/api/errors';
import { withEgressGuard } from '@/lib/security/egressGuard';

async function DELETE_impl(
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
    return redactedJson({ error: 'Failed to unpublish game' }, { status: 500 });
  }
}

// Egress guard (#9736): every response this route returns leaves through the
// one redaction chokepoint. See `src/lib/security/egressGuard.ts`.
export const DELETE = withEgressGuard(DELETE_impl);
