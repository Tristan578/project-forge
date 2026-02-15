import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { gameComments, users } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { authenticateRequest } from '@/lib/auth/api-auth';

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
        authorEmail: users.email,
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
      authorEmail: string | null;
    }) => ({
      id: c.id,
      content: c.content,
      parentId: c.parentId,
      authorId: c.authorId,
      authorName: c.authorName || c.authorEmail?.split('@')[0] || 'Unknown',
      createdAt: c.createdAt.toISOString(),
    }));

    return NextResponse.json({ comments: formattedComments });
  } catch (error) {
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

    const { id: gameId } = await params;
    const body = await req.json();
    const { content, parentId } = body;

    // Validate content
    if (!content || typeof content !== 'string') {
      return NextResponse.json({ error: 'Content is required' }, { status: 400 });
    }

    // Sanitize content (strip HTML, limit length)
    const sanitized = content
      .replace(/<[^>]*>/g, '') // Strip HTML tags
      .trim()
      .slice(0, 1000); // Max 1000 chars

    if (sanitized.length === 0) {
      return NextResponse.json(
        { error: 'Comment cannot be empty' },
        { status: 400 }
      );
    }

    // Insert comment
    const [comment] = await db
      .insert(gameComments)
      .values({
        gameId,
        userId: authResult.ctx.user.id,
        content: sanitized,
        parentId: parentId || null,
      })
      .returning();

    // Fetch author info
    const author = await db
      .select({
        displayName: users.displayName,
        email: users.email,
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
          authorName:
            author[0]?.displayName || author[0]?.email?.split('@')[0] || 'Unknown',
          createdAt: comment.createdAt.toISOString(),
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Failed to post comment:', error);
    return NextResponse.json(
      { error: 'Failed to post comment' },
      { status: 500 }
    );
  }
}
