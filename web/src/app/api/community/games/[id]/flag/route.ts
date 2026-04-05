import { NextRequest, NextResponse } from 'next/server';
import { getDb, queryWithResilience } from '@/lib/db/client';
import { gameComments } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { withApiMiddleware } from '@/lib/api/middleware';
import { captureException } from '@/lib/monitoring/sentry-server';

export const dynamic = 'force-dynamic';

// Flag a comment for moderation
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const mid = await withApiMiddleware(req, {
      requireAuth: true,
      rateLimit: true,
      rateLimitConfig: { key: (id) => `flag:${id}`, max: 10, windowSeconds: 60 },
    });
    if (mid.error) return mid.error;

    const { id: gameId } = await params;
    const body = await req.json();
    const { commentId } = body;

    if (!commentId || typeof commentId !== 'string') {
      return NextResponse.json({ error: 'commentId is required' }, { status: 400 });
    }

    // Verify comment belongs to this game and is not already flagged
    const [comment] = await queryWithResilience(() => getDb()
      .select({ id: gameComments.id, flagged: gameComments.flagged })
      .from(gameComments)
      .where(and(eq(gameComments.id, commentId), eq(gameComments.gameId, gameId)))
      .limit(1));

    if (!comment) {
      return NextResponse.json({ error: 'Comment not found' }, { status: 404 });
    }

    if (comment.flagged > 0) {
      return NextResponse.json({ flagged: true, message: 'Already flagged' });
    }

    // Flag the comment
    await queryWithResilience(() => getDb()
      .update(gameComments)
      .set({ flagged: 1 })
      .where(eq(gameComments.id, commentId)));

    return NextResponse.json({ flagged: true });
  } catch (error) {
    captureException(error, { route: '/api/community/games/[id]/flag' });
    return NextResponse.json(
      { error: 'Failed to flag comment' },
      { status: 500 }
    );
  }
}
