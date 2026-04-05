import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/lib/api/middleware';
import { deleteUserAccount } from '@/lib/auth/user-service';
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

  try {
    await deleteUserAccount(mid.userId!);
    return NextResponse.json({ deleted: true });
  } catch (err) {
    captureException(err, { route: '/api/user/delete' });
    return NextResponse.json(
      { error: 'Failed to delete account' },
      { status: 500 }
    );
  }
}
