import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { moderationAppeals, users } from '@/lib/db/schema';
import { eq, desc, count } from 'drizzle-orm';
import { authenticateRequest, assertAdmin } from '@/lib/auth/api-auth';
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
    const authResult = await authenticateRequest();
    if (!authResult.ok) return authResult.response;

    const adminError = assertAdmin(authResult.ctx.clerkId);
    if (adminError) return adminError;

    const rateLimitError = await rateLimitAdminRoute(authResult.ctx.clerkId, 'admin-moderation-appeals');
    if (rateLimitError) return rateLimitError;

    const db = getDb();
    const searchParams = req.nextUrl.searchParams;
    const parsedLimit = parseInt(searchParams.get('limit') || '50', 10);
    const limit = Math.min(Number.isFinite(parsedLimit) ? parsedLimit : 50, 100);
    const parsedOffset = parseInt(searchParams.get('offset') || '0', 10);
    const offset = Number.isFinite(parsedOffset) ? parsedOffset : 0;
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
