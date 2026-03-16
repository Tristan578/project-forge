import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { moderationAppeals } from '@/lib/db/schema';
import { authenticateRequest } from '@/lib/auth/api-auth';

export const dynamic = 'force-dynamic';

const VALID_CONTENT_TYPES = ['comment', 'asset', 'game'];

/**
 * POST /api/moderation/appeal
 * Authenticated users can submit an appeal for blocked/flagged content.
 * Body: { contentId, contentType, reason }
 */
export async function POST(req: NextRequest) {
  try {
    const authResult = await authenticateRequest();
    if (!authResult.ok) return authResult.response;

    const body = await req.json();
    const { contentId, contentType, reason } = body;

    if (!contentId || typeof contentId !== 'string') {
      return NextResponse.json({ error: 'Missing or invalid contentId' }, { status: 400 });
    }

    if (!contentType || !VALID_CONTENT_TYPES.includes(contentType)) {
      return NextResponse.json(
        { error: `contentType must be one of: ${VALID_CONTENT_TYPES.join(', ')}` },
        { status: 400 }
      );
    }

    if (!reason || typeof reason !== 'string' || reason.trim().length < 10) {
      return NextResponse.json(
        { error: 'Reason must be at least 10 characters' },
        { status: 400 }
      );
    }

    if (reason.length > 2000) {
      return NextResponse.json(
        { error: 'Reason must be at most 2000 characters' },
        { status: 400 }
      );
    }

    const db = getDb();
    const [appeal] = await db
      .insert(moderationAppeals)
      .values({
        userId: authResult.ctx.user.id,
        contentId,
        contentType,
        reason: reason.trim(),
      })
      .returning();

    return NextResponse.json({ id: appeal.id, status: appeal.status }, { status: 201 });
  } catch (error) {
    console.error('Failed to submit appeal:', error);
    return NextResponse.json(
      { error: 'Failed to submit appeal' },
      { status: 500 }
    );
  }
}
