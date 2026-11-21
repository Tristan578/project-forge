import { NextRequest, NextResponse } from 'next/server';
import { clerkClient } from '@clerk/nextjs/server';
import { withApiMiddleware } from '@/lib/api/middleware';
import { deleteUserAccount } from '@/lib/auth/user-service';
import { requireStepUp } from '@/lib/auth/step-up';
import { STEP_UP_ROUTES } from '@/lib/auth/security-policy';
import { captureException } from '@/lib/monitoring/sentry-server';

/**
 * POST /api/user/delete
 * Permanently delete the authenticated user's account and all associated data.
 */
export async function POST(req: NextRequest) {
  const mid = await withApiMiddleware(req, {
    requireAuth: true,
    rateLimit: true,
    rateLimitConfig: { key: (id) => `user:account-delete:${id}`, max: 5, windowSeconds: 60 },
  });
  if (mid.error) return mid.error;

  // Step-up: permanently deleting an account + all data is the highest-stakes
  // action in the app. Require a recent 2FA re-verification so a stale/lifted
  // session token can't nuke the account. No-ops without Clerk (CI/E2E/dev).
  const stepUp = await requireStepUp(STEP_UP_ROUTES['user-delete'].config);
  if (!stepUp.ok) return stepUp.response;

  // 1. Purge all DB data first. This is the privacy-critical step (PII,
  //    projects, financial records), so it must succeed before we touch Clerk —
  //    if it fails we 500 and leave the Clerk identity intact so the user isn't
  //    locked out of an account whose data still exists.
  try {
    await deleteUserAccount(mid.userId!);
  } catch (err) {
    captureException(err, { route: '/api/user/delete' });
    return NextResponse.json(
      { error: 'Failed to delete account' },
      { status: 500 }
    );
  }

  // 2. Delete the Clerk identity. Without this the Clerk session/user survives,
  //    and the next authenticated request re-syncs a fresh empty DB user from
  //    Clerk — silently resurrecting the "deleted" account (#8606). The
  //    destructive DB delete has already committed, so a Clerk-side failure must
  //    NOT surface as a 500 (that would imply nothing was deleted and invite a
  //    confusing retry). Report success and alert Sentry for manual cleanup of
  //    the orphaned Clerk user.
  try {
    const client = await clerkClient();
    await client.users.deleteUser(mid.authContext!.clerkId);
  } catch (err) {
    captureException(err, {
      route: '/api/user/delete',
      step: 'clerk-delete',
      clerkId: mid.authContext!.clerkId,
    });
  }

  return NextResponse.json({ deleted: true });
}
