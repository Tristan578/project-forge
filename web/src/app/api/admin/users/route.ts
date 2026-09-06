import { NextRequest, NextResponse } from 'next/server';
import { assertAdmin } from '@/lib/auth/api-auth';
import { withApiMiddleware } from '@/lib/api/middleware';
import { rateLimitAdminRoute } from '@/lib/rateLimit';
import { getDb, queryWithResilience } from '@/lib/db/client';
import { users } from '@/lib/db/schema';
import { ilike, or, desc } from 'drizzle-orm';
import { captureException } from '@/lib/monitoring/sentry-server';
import { redactedJson } from '@/lib/api/errors';
import { withEgressGuard } from '@/lib/security/egressGuard';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

async function GET_impl(req: NextRequest) {
  const mid = await withApiMiddleware(req, { requireAuth: true });
  if (mid.error) return mid.error;
  const { clerkId } = mid.authContext!;

  const adminError = assertAdmin(clerkId);
  if (adminError) return adminError;

  const rateLimitError = await rateLimitAdminRoute(clerkId, 'admin-users');
  if (rateLimitError) return rateLimitError;

  const { searchParams } = req.nextUrl;
  const rawLimit = parseInt(searchParams.get('limit') ?? String(DEFAULT_LIMIT), 10);
  const limit = isNaN(rawLimit) || rawLimit < 1 ? DEFAULT_LIMIT : Math.min(rawLimit, MAX_LIMIT);
  const rawOffset = parseInt(searchParams.get('offset') ?? '0', 10);
  const offset = isNaN(rawOffset) || rawOffset < 0 ? 0 : rawOffset;
  const search = (searchParams.get('search') ?? '').trim();

  try {
    const selectedFields = {
      id: users.id,
      email: users.email,
      clerkId: users.clerkId,
      displayName: users.displayName,
      tier: users.tier,
      monthlyTokens: users.monthlyTokens,
      monthlyTokensUsed: users.monthlyTokensUsed,
      addonTokens: users.addonTokens,
      banned: users.banned,
      createdAt: users.createdAt,
    };

    const rows = await queryWithResilience(() => {
      // eslint-disable-next-line no-restricted-syntax -- db ref needed for branching inside queryWithResilience
      const db = getDb();
      if (search) {
        const pattern = `%${search}%`;
        return db
          .select(selectedFields)
          .from(users)
          .where(or(ilike(users.email, pattern), ilike(users.displayName, pattern)))
          .orderBy(desc(users.createdAt))
          .limit(limit)
          .offset(offset);
      } else {
        return db
          .select(selectedFields)
          .from(users)
          .orderBy(desc(users.createdAt))
          .limit(limit)
          .offset(offset);
      }
    });

    return NextResponse.json({ users: rows, limit, offset });
  } catch (error) {
    captureException(error, { route: '/api/admin/users' });
    return redactedJson({ error: 'Internal server error' }, { status: 500 });
  }
}

// Egress guard (#9736): every response this route returns leaves through the
// one redaction chokepoint. See `src/lib/security/egressGuard.ts`.
export const GET = withEgressGuard(GET_impl);
