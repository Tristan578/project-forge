import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { getDb } from '@/lib/db/client';
import { apiKeys } from '@/lib/db/schema';
import { rateLimit, rateLimitResponse } from '@/lib/rateLimit';
import { captureException } from '@/lib/monitoring/sentry-server';

/** DELETE /api/keys/api-key/:id — revoke an API key */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await authenticateRequest();
    if (!authResult.ok) return authResult.response;

<<<<<<< HEAD
  const rl = await rateLimit(`user:api-key-delete:${authResult.ctx.user.id}`, 10, 60_000);
  if (!rl.allowed) return rateLimitResponse(rl.remaining, rl.resetAt);

  const { id } = await params;
  const db = getDb();
=======
    const { id } = await params;
    const db = getDb();
>>>>>>> d3c18920 (Add Sentry captureException to keys, jobs, and marketplace asset routes (batch 4))

    const deleted = await db
      .delete(apiKeys)
      .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, authResult.ctx.user.id)))
      .returning({ id: apiKeys.id });

    if (deleted.length === 0) {
      return NextResponse.json({ error: 'API key not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, revoked: id });
  } catch (err) {
    captureException(err, { route: '/api/keys/api-key/[id]', method: 'DELETE' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
