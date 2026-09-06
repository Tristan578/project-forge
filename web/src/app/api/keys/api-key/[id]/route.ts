import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { withApiMiddleware } from '@/lib/api/middleware';
import { getDb, queryWithResilience } from '@/lib/db/client';
import { apiKeys } from '@/lib/db/schema';
import { withEgressGuard } from '@/lib/security/egressGuard';

/** DELETE /api/keys/api-key/:id — revoke an API key */
async function DELETE_impl(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const mid = await withApiMiddleware(req, {
    requireAuth: true,
    rateLimit: true,
    rateLimitConfig: { key: (id) => `user:api-key-delete:${id}`, max: 10, windowSeconds: 60, distributed: false },
  });
  if (mid.error) return mid.error;

  const { id } = await params;

  const deleted = await queryWithResilience(() =>
    getDb()
      .delete(apiKeys)
      .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, mid.userId!)))
      .returning({ id: apiKeys.id })
  );

  if (deleted.length === 0) {
    return NextResponse.json({ error: 'API key not found' }, { status: 404 });
  }

  return NextResponse.json({ success: true, revoked: id });
}

// Egress guard (#9736): every response this route returns leaves through the
// one redaction chokepoint. See `src/lib/security/egressGuard.ts`.
export const DELETE = withEgressGuard(DELETE_impl);
