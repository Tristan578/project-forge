import { NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { deleteUserAccount } from '@/lib/auth/user-service';
import { rateLimit, rateLimitResponse } from '@/lib/rateLimit';
import { captureException } from '@/lib/monitoring/sentry-server';

/**
 * POST /api/user/delete
 * Permanently delete the authenticated user's account and all associated data.
 */
export async function POST() {
  const authResult = await authenticateRequest();
  if (!authResult.ok) return authResult.response;

  const rl = await rateLimit(`user:account-delete:${authResult.ctx.user.id}`, 5, 60_000);
  if (!rl.allowed) return rateLimitResponse(rl.remaining, rl.resetAt);

  try {
    await deleteUserAccount(authResult.ctx.user.id);
    return NextResponse.json({ deleted: true });
  } catch (err) {
    console.error('Account deletion failed:', err);
    captureException(err, { route: '/api/user/delete' });
    return NextResponse.json(
      { error: 'Failed to delete account' },
      { status: 500 }
    );
  }
}
