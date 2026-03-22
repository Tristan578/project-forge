import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { gameComments } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { rateLimit, rateLimitResponse } from '@/lib/rateLimit';
import { captureException } from '@/lib/monitoring/sentry-server';

export const dynamic = 'force-dynamic';

// Flag a comment for moderation
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await authenticateRequest();
    if (!authResult.ok) return authResult.response;

    // Rate limit: 10 flags per minute per user
    const rl = await rateLimit(`flag:${authResult.ctx.user.id}`, 10, 60_000);
    if (!rl.allowed) return rateLimitResponse(rl.remaining, rl.resetAt);

    const { id: gameId } = await params;
    const body = await req.json();
    const { commentId } = body;

    if (!commentId || typeof commentId !== 'string') {
      return NextResponse.json({ error: 'commentId is required' }, { status: 400 });
    }

    const db = getDb();

    // Verify comment belongs to this game and is not already flagged
    const [comment] = await db
      .select({ id: gameComments.id, flagged: gameComments.flagged })
      .from(gameComments)
      .where(and(eq(gameComments.id, commentId), eq(gameComments.gameId, gameId)))
      .limit(1);

    if (!comment) {
      return NextResponse.json({ error: 'Comment not found' }, { status: 404 });
    }

    if (comment.flagged > 0) {
      return NextResponse.json({ flagged: true, message: 'Already flagged' });
    }

    // Flag the comment
    await db
      .update(gameComments)
      .set({ flagged: 1 })
      .where(eq(gameComments.id, commentId));

    return NextResponse.json({ flagged: true });
  } catch (error) {
    captureException(error, { route: '/api/community/games/[id]/flag' });
    console.error('Failed to flag comment:', error);
    return NextResponse.json(
      { error: 'Failed to flag comment' },
      { status: 500 }
    );
  }
}
