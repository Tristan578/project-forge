import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { getDb } from '@/lib/db/client';
import { publishedGames } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { rateLimit, rateLimitResponse } from '@/lib/rateLimit';
import { captureException } from '@/lib/monitoring/sentry-server';

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await authenticateRequest();
    if (!authResult.ok) return authResult.response;
    const { user } = authResult.ctx;

<<<<<<< HEAD
  const rl = await rateLimit(`user:publish-delete:${user.id}`, 10, 60_000);
  if (!rl.allowed) return rateLimitResponse(rl.remaining, rl.resetAt);

  const { id } = await params;
  const db = getDb();
=======
    const { id } = await params;
    const db = getDb();
>>>>>>> 381bb161 (Add Sentry captureException to moderation, openapi, play, projects, and publish routes (batch 6))

    await db.update(publishedGames)
      .set({ status: 'unpublished', updatedAt: new Date() })
      .where(and(eq(publishedGames.id, id), eq(publishedGames.userId, user.id)));

    return NextResponse.json({ success: true });
  } catch (err) {
    captureException(err, { route: '/api/publish/[id]', method: 'DELETE' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
