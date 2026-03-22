import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { gameComments, users } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { rateLimit, rateLimitResponse } from '@/lib/rateLimit';
import { moderateContent } from '@/lib/moderation/contentFilter';
import { containsBlockedKeyword } from '@/lib/moderation/keywords';
import { parseJsonBody, requireString, optionalString } from '@/lib/apiValidation';
import { captureException } from '@/lib/monitoring/sentry-server';

export const dynamic = 'force-dynamic';

// Get comments for a game
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const db = getDb();
    const { id: gameId } = await params;

    const comments = await db
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
      .where(and(eq(gameComments.gameId, gameId), eq(gameComments.flagged, 0)));

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
    console.error('Failed to fetch comments:', error);
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
    const db = getDb();
    const authResult = await authenticateRequest();
    if (!authResult.ok) return authResult.response;

    // Rate limit: 20 comments per minute per user
    const rl = await rateLimit(`comment:${authResult.ctx.user.id}`, 20, 60_000);
    if (!rl.allowed) return rateLimitResponse(rl.remaining, rl.resetAt);

    const { id: gameId } = await params;

    const parsed = await parseJsonBody(req);
    if (!parsed.ok) return parsed.response;

    const contentResult = requireString(parsed.body.content, 'Content', { minLength: 1, maxLength: 1000 });
    if (!contentResult.ok) return contentResult.response;

    const parentResult = optionalString(parsed.body.parentId, 'Parent ID', { maxLength: 100 });
    if (!parentResult.ok) return parentResult.response;

    // Sanitize content (remove angle brackets to prevent tag injection)
    const sanitized = contentResult.value.replace(/[<>]/g, '');

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
    const [comment] = await db
      .insert(gameComments)
      .values({
        gameId,
        userId: authResult.ctx.user.id,
        content: sanitized,
        parentId: parentResult.value ?? null,
        flagged: shouldFlag ? 1 : 0,
      })
      .returning();

    // Fetch author info
    const author = await db
      .select({
        displayName: users.displayName,
      })
      .from(users)
      .where(eq(users.id, authResult.ctx.user.id))
      .limit(1);

    return NextResponse.json(
      {
        comment: {
          id: comment.id,
          content: comment.content,
          parentId: comment.parentId,
          authorId: authResult.ctx.user.id,
          authorName: author[0]?.displayName || 'Unknown',
          createdAt: comment.createdAt.toISOString(),
        },
      },
      { status: 201 }
    );
  } catch (error) {
    captureException(error, { route: '/api/community/games/[id]/comment', method: 'POST' });
    console.error('Failed to post comment:', error);
    return NextResponse.json(
      { error: 'Failed to post comment' },
      { status: 500 }
    );
  }
}
