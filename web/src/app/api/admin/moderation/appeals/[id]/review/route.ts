import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb, queryWithResilience } from '@/lib/db/client';
import { moderationAppeals, gameComments, publishedGames } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { assertAdmin } from '@/lib/auth/api-auth';
import { withApiMiddleware } from '@/lib/api/middleware';
import { rateLimitAdminRoute } from '@/lib/rateLimit';
import { captureException } from '@/lib/monitoring/sentry-server';

export const dynamic = 'force-dynamic';

const reviewAppealSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  note: z.string().trim().max(2000).optional(),
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/admin/moderation/appeals/[id]/review
 * Admin approves or rejects a moderation appeal.
 * Body: { decision: 'approve' | 'reject', note?: string }
 *
 * On approve: restore the original content — a comment is unflagged
 * (flagged=0), a game auto-hidden by viewer reports goes back to
 * status='published' with flaggedAt cleared (#8354).
 * On reject: mark appeal as rejected.
 *
 * `moderationAppeals.contentType` also admits 'asset'. There is no asset
 * takedown state to restore today, so an approved asset appeal deliberately
 * records the decision and mutates nothing.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const mid = await withApiMiddleware(req, {
      requireAuth: true,
      validate: reviewAppealSchema,
    });
    if (mid.error) return mid.error;

    const adminError = assertAdmin(mid.authContext!.clerkId);
    if (adminError) return adminError;

    const rateLimitError = await rateLimitAdminRoute(mid.userId!, 'admin-moderation-appeals-review');
    if (rateLimitError) return rateLimitError;

    const { id } = await params;
    const { decision, note } = mid.body as z.infer<typeof reviewAppealSchema>;

    // Fetch the appeal
    const [appeal] = await queryWithResilience(() =>
      getDb()
        .select()
        .from(moderationAppeals)
        .where(eq(moderationAppeals.id, id))
        .limit(1)
    );

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
    await queryWithResilience(() =>
      getDb()
        .update(moderationAppeals)
        .set({
          status: newStatus,
          reviewedBy: mid.authContext!.clerkId,
          reviewNote: note ?? null,
          reviewedAt: new Date(),
        })
        .where(eq(moderationAppeals.id, id))
    );

    // If approved and the content is a comment, unflag it. Defense-in-depth:
    // re-confirm the appellant authored the comment before mutating its flag,
    // so a stale/forged appeal cannot unflag a comment its filer never owned
    // (the appeal POST also enforces ownership at submission time) (#8613).
    if (decision === 'approve' && appeal.contentType === 'comment') {
      await queryWithResilience(() =>
        getDb()
          .update(gameComments)
          .set({ flagged: 0 })
          .where(
            and(
              eq(gameComments.id, appeal.contentId),
              eq(gameComments.userId, appeal.userId)
            )
          )
      );
    }

    // Games: a won appeal must actually un-hide the game. Without this branch
    // POST /api/moderation/appeal already accepted contentType 'game' but the
    // review restored nothing, so a viewer report hid a game permanently even
    // when the creator won the appeal (#8354).
    //
    // Scoped the same way as the comment branch (#8613): the appellant must
    // still own the game, and the row must still be 'flagged' — an appeal can
    // lift a moderation hold, never republish a game whose creator has since
    // unpublished it themselves.
    if (
      decision === 'approve' &&
      appeal.contentType === 'game' &&
      // moderation_appeals.content_id is a free-form text column; published_games.id
      // is uuid. POST /api/moderation/appeal validates the shape on the way in,
      // but comparing a non-uuid here would raise `invalid input syntax for type
      // uuid` and turn a bad row into a 500 for the whole review.
      UUID_RE.test(appeal.contentId)
    ) {
      await queryWithResilience(() =>
        getDb()
          .update(publishedGames)
          .set({ status: 'published', flaggedAt: null, updatedAt: new Date() })
          .where(
            and(
              eq(publishedGames.id, appeal.contentId),
              eq(publishedGames.userId, appeal.userId),
              eq(publishedGames.status, 'flagged')
            )
          )
      );
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
