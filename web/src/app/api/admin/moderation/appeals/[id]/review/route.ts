import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { moderationAppeals, gameComments } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { authenticateRequest, assertAdmin } from '@/lib/auth/api-auth';
import { rateLimitAdminRoute } from '@/lib/rateLimit';

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
    const authResult = await authenticateRequest();
    if (!authResult.ok) return authResult.response;

    const adminError = assertAdmin(authResult.ctx.clerkId);
    if (adminError) return adminError;

    const rateLimitError = rateLimitAdminRoute(authResult.ctx.clerkId, 'admin-moderation-appeals-review');
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
        reviewedBy: authResult.ctx.clerkId,
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
    console.error('Failed to review appeal:', error);
    return NextResponse.json(
      { error: 'Failed to review appeal' },
      { status: 500 }
    );
  }
}
