import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { moderationAppeals, gameComments } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { assertAdmin } from '@/lib/auth/api-auth';
import { withApiMiddleware } from '@/lib/api/middleware';
import { rateLimitAdminRoute } from '@/lib/rateLimit';
import { captureException } from '@/lib/monitoring/sentry-server';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/moderation/appeals/[id]/review
 * Admin approves or rejects a moderation appeal.
 * Body: { decision: 'approve' | 'reject', note?: string }
 *
 * On approve: unflag the original content (if it's a comment, set flagged=0).
 * On reject: mark appeal as rejected.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const mid = await withApiMiddleware(req, { requireAuth: true });
    if (mid.error) return mid.error;

    const adminError = assertAdmin(mid.authContext!.clerkId);
    if (adminError) return adminError;

    const rateLimitError = await rateLimitAdminRoute(mid.userId!, 'admin-moderation-appeals-review');
    if (rateLimitError) return rateLimitError;

    const { id } = await params;
    const body = await req.json();
    const { decision, note } = body;

    if (!decision || (decision !== 'approve' && decision !== 'reject')) {
      return NextResponse.json(
        { error: 'decision must be "approve" or "reject"' },
        { status: 400 }
      );
    }

    const db = getDb();

    // Fetch the appeal
    const [appeal] = await db
      .select()
      .from(moderationAppeals)
      .where(eq(moderationAppeals.id, id))
      .limit(1);

    if (!appeal) {
      return NextResponse.json({ error: 'Appeal not found' }, { status: 404 });
    }

    if (appeal.status !== 'pending') {
      return NextResponse.json(
        { error: 'Appeal has already been reviewed' },
        { status: 409 }
      );
    }

    const newStatus = decision === 'approve' ? 'approved' : 'rejected';

    // Update the appeal
    await db
      .update(moderationAppeals)
      .set({
        status: newStatus,
        reviewedBy: mid.authContext!.clerkId,
        reviewNote: typeof note === 'string' ? note.trim() : null,
        reviewedAt: new Date(),
      })
      .where(eq(moderationAppeals.id, id));

    // If approved and the content is a comment, unflag it
    if (decision === 'approve' && appeal.contentType === 'comment') {
      await db
        .update(gameComments)
        .set({ flagged: 0 })
        .where(eq(gameComments.id, appeal.contentId));
    }

    return NextResponse.json({
      success: true,
      id,
      status: newStatus,
    });
  } catch (error) {
    captureException(error, { route: '/api/admin/moderation/appeals/[id]/review' });
    console.error('Failed to review appeal:', error);
    return NextResponse.json(
      { error: 'Failed to review appeal' },
      { status: 500 }
    );
  }
}
