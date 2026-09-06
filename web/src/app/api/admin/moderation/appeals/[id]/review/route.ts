import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb, getNeonSql, queryWithResilience } from '@/lib/db/client';
import { moderationAppeals, gameComments } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { assertAdmin } from '@/lib/auth/api-auth';
import { withApiMiddleware } from '@/lib/api/middleware';
import { rateLimitAdminRoute } from '@/lib/rateLimit';
import { captureException } from '@/lib/monitoring/sentry-server';
import { redactedJson } from '@/lib/api/errors';

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
 * (flagged=0), a game auto-hidden by viewer reports has its moderation hold
 * lifted (flaggedAt cleared, reportCount reset) and goes back to
 * status='published' if it was still flagged (#8354). The response carries
 * `gameRestored` for a game appeal so an approve that matched no row is
 * visible rather than reported as a plain success.
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
    // still own the game. The row is matched on `flagged_at IS NOT NULL`, not
    // on `status = 'flagged'`, for the reason spelled out in the admin queue
    // route — `flagged_at` is the field POST /api/publish refuses to republish
    // over, so a creator who unpublished their game while the appeal was open
    // was left with a permanent hold that no won appeal could lift. The CASE
    // preserves the other guarantee: winning an appeal restores 'published'
    // only for a row that was actually flagged, never for one the creator took
    // down themselves. `report_count` is reset for the same per-review-cycle
    // reason as an admin approve (see REPORT_AUTOHIDE_THRESHOLD's docblock).
    let gameRestored: boolean | undefined;
    if (
      decision === 'approve' &&
      appeal.contentType === 'game' &&
      // moderation_appeals.content_id is a free-form text column; published_games.id
      // is uuid. POST /api/moderation/appeal validates the shape on the way in,
      // but comparing a non-uuid here would raise `invalid input syntax for type
      // uuid` and turn a bad row into a 500 for the whole review.
      UUID_RE.test(appeal.contentId)
    ) {
      const restored = (await queryWithResilience(
        () => getNeonSql()`
          UPDATE published_games
          SET status = CASE
                WHEN status = 'flagged' THEN 'published'::publish_status
                ELSE status
              END,
              flagged_at = NULL,
              report_count = 0,
              updated_at = now()
          WHERE id = ${appeal.contentId}::uuid
            AND user_id = ${appeal.userId}::uuid
            AND flagged_at IS NOT NULL
          RETURNING id
        `
      )) as unknown as { id: string }[];

      // Surface the outcome instead of reporting a blanket success. An appeal
      // marked "approved" whose restore matched nothing is the failure mode
      // worth catching: the creator is told they won and their game is still
      // held, and nothing in the response distinguishes that from a real
      // restore.
      gameRestored = restored.length > 0;
      if (!gameRestored) {
        console.warn(
          '[appeals/review] approved game appeal restored no row',
          { appealId: id, contentId: appeal.contentId }
        );
      }
    }

    return NextResponse.json({
      success: true,
      id,
      status: newStatus,
      ...(gameRestored === undefined ? {} : { gameRestored }),
    });
  } catch (error) {
    captureException(error, { route: '/api/admin/moderation/appeals/[id]/review' });
    console.error('Failed to review appeal:', error);
    return redactedJson(
      { error: 'Failed to review appeal' },
      { status: 500 }
    );
  }
}
