import { NextRequest, NextResponse } from 'next/server';
import { getDb, queryWithResilience } from '@/lib/db/client';
import { gameComments, users } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { withApiMiddleware } from '@/lib/api/middleware';
import { rateLimitPublicRoute } from '@/lib/rateLimit';
import { moderateContent } from '@/lib/moderation/contentFilter';
import { containsBlockedKeyword } from '@/lib/moderation/keywords';
import { captureException } from '@/lib/monitoring/sentry-server';
import { z } from 'zod';

const commentSchema = z.object({
  content: z.string().min(1).max(1000),
  parentId: z.string().max(100).optional(),
});

export const dynamic = 'force-dynamic';

// Get comments for a game
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const limited = await rateLimitPublicRoute(req, 'community-game-comments', 30, 60_000);
  if (limited) return limited;

  try {
    const { id: gameId } = await params;

    const comments = await queryWithResilience(() => getDb()
      .select({
        id: gameComments.id,
        content: gameComments.content,
        parentId: gameComments.parentId,
        createdAt: gameComments.createdAt,
        authorId: gameComments.userId,
        authorName: users.displayName,
      })
      .from(gameComments)
      .leftJoin(users, eq(gameComments.userId, users.id))
      .where(and(eq(gameComments.gameId, gameId), eq(gameComments.flagged, 0))));

    const formattedComments = comments.map((c: {
      id: string;
      content: string;
      parentId: string | null;
      createdAt: Date;
      authorId: string | null;
      authorName: string | null;
    }) => ({
      id: c.id,
      content: c.content,
      parentId: c.parentId,
      authorId: c.authorId,
      authorName: c.authorName || 'Unknown',
      createdAt: c.createdAt.toISOString(),
    }));

    return NextResponse.json({ comments: formattedComments });
  } catch (error) {
    captureException(error, { route: '/api/community/games/[id]/comment', method: 'GET' });
    return NextResponse.json(
      { error: 'Failed to fetch comments' },
      { status: 500 }
    );
  }
}

// Post a comment
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const mid = await withApiMiddleware(req, {
      requireAuth: true,
      rateLimit: true,
      rateLimitConfig: { key: (id) => `comment:${id}`, max: 20, windowSeconds: 60 },
      validate: commentSchema,
    });
    if (mid.error) return mid.error;

    const { id: gameId } = await params;
    const { content, parentId } = mid.body as z.infer<typeof commentSchema>;

    // Sanitize content: remove ASCII angle brackets and their Unicode lookalikes
    // to prevent tag injection. Unicode alternatives include single/double angle
    // quotation marks, mathematical angle brackets, and CJK angle brackets.
    const sanitized = content
      .replace(/[<>]/g, '')
      .replace(/[\u2039\u203A\u00AB\u00BB\u2329\u232A\u3008\u3009]/g, '');

    if (sanitized.length === 0) {
      return NextResponse.json(
        { error: 'Comment cannot be empty' },
        { status: 400 }
      );
    }

    // Content moderation check
    const modResult = moderateContent(sanitized);
    if (modResult.severity === 'block') {
      return NextResponse.json(
        { error: 'Comment contains prohibited content' },
        { status: 422 }
      );
    }

    // Auto-flag if severity filter OR keyword blocklist detects issues
    const keywordFlagged = containsBlockedKeyword(sanitized);
    const shouldFlag = modResult.severity === 'flag' || keywordFlagged;

    // Insert comment (auto-flag if filter detects issues)
    const [comment] = await queryWithResilience(() => getDb()
      .insert(gameComments)
      .values({
        gameId,
        userId: mid.userId!,
        content: sanitized,
        parentId: parentId ?? null,
        flagged: shouldFlag ? 1 : 0,
      })
      .returning());

    // Fetch author info
    const author = await queryWithResilience(() => getDb()
      .select({
        displayName: users.displayName,
      })
      .from(users)
      .where(eq(users.id, mid.userId!))
      .limit(1));

    return NextResponse.json(
      {
        comment: {
          id: comment.id,
          content: comment.content,
          parentId: comment.parentId,
          authorId: mid.userId!,
          authorName: author[0]?.displayName || 'Unknown',
          createdAt: comment.createdAt.toISOString(),
        },
      },
      { status: 201 }
    );
  } catch (error) {
    captureException(error, { route: '/api/community/games/[id]/comment', method: 'POST' });
    return NextResponse.json(
      { error: 'Failed to post comment' },
      { status: 500 }
    );
  }
}
