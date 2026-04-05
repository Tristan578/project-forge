import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { moderationAppeals, users } from '@/lib/db/schema';
import { eq, desc, count } from 'drizzle-orm';
import { assertAdmin } from '@/lib/auth/api-auth';
import { withApiMiddleware } from '@/lib/api/middleware';
import { rateLimitAdminRoute } from '@/lib/rateLimit';
import { captureException } from '@/lib/monitoring/sentry-server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/moderation/appeals
 * Returns pending moderation appeals for admin review.
 * Supports pagination via ?limit=N&offset=N and optional ?status=pending|approved|rejected
 */
export async function GET(req: NextRequest) {
  try {
    const mid = await withApiMiddleware(req, { requireAuth: true });
    if (mid.error) return mid.error;

    const adminError = assertAdmin(mid.authContext!.clerkId);
    if (adminError) return adminError;

    const rateLimitError = await rateLimitAdminRoute(mid.authContext!.clerkId, 'admin-moderation-appeals');
    if (rateLimitError) return rateLimitError;

    const db = getDb();
    const searchParams = req.nextUrl.searchParams;
    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 100);
    const offset = parseInt(searchParams.get('offset') || '0', 10);
    const statusFilter = searchParams.get('status') || 'pending';

    const validStatuses = ['pending', 'approved', 'rejected'];
    if (!validStatuses.includes(statusFilter)) {
      return NextResponse.json(
        { error: `status must be one of: ${validStatuses.join(', ')}` },
        { status: 400 }
      );
    }

    const statusValue = statusFilter as 'pending' | 'approved' | 'rejected';

    const [appeals, countResult] = await Promise.all([
      db
        .select({
          id: moderationAppeals.id,
          contentId: moderationAppeals.contentId,
          contentType: moderationAppeals.contentType,
          reason: moderationAppeals.reason,
          status: moderationAppeals.status,
          userId: moderationAppeals.userId,
          userName: users.displayName,
          userEmail: users.email,
          createdAt: moderationAppeals.createdAt,
          reviewedAt: moderationAppeals.reviewedAt,
        })
        .from(moderationAppeals)
        .leftJoin(users, eq(moderationAppeals.userId, users.id))
        .where(eq(moderationAppeals.status, statusValue))
        .orderBy(desc(moderationAppeals.createdAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ total: count() })
        .from(moderationAppeals)
        .where(eq(moderationAppeals.status, statusValue)),
    ]);

    const total = countResult[0]?.total ?? 0;

    return NextResponse.json({
      items: appeals.map((a) => ({
        id: a.id,
        contentId: a.contentId,
        contentType: a.contentType,
        reason: a.reason,
        status: a.status,
        userId: a.userId,
        userName: a.userName || 'Unknown',
        userEmail: a.userEmail,
        createdAt: a.createdAt.toISOString(),
        reviewedAt: a.reviewedAt?.toISOString() ?? null,
      })),
      total,
    });
  } catch (error) {
    captureException(error, { route: '/api/admin/moderation/appeals' });
    console.error('Failed to fetch appeals:', error);
    return NextResponse.json(
      { error: 'Failed to fetch appeals' },
      { status: 500 }
    );
  }
}
