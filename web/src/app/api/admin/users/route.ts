import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, assertAdmin } from '@/lib/auth/api-auth';
import { rateLimitAdminRoute } from '@/lib/rateLimit';
import { getDb } from '@/lib/db/client';
import { users } from '@/lib/db/schema';
import { ilike, or, desc } from 'drizzle-orm';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export async function GET(req: NextRequest) {
  const authResult = await authenticateRequest();
  if (!authResult.ok) return authResult.response;
  const { clerkId } = authResult.ctx;

  const adminError = assertAdmin(clerkId);
  if (adminError) return adminError;

  const rateLimitError = rateLimitAdminRoute(clerkId, 'admin-users');
  if (rateLimitError) return rateLimitError;

  const { searchParams } = req.nextUrl;
  const rawLimit = parseInt(searchParams.get('limit') ?? String(DEFAULT_LIMIT), 10);
  const limit = isNaN(rawLimit) || rawLimit < 1 ? DEFAULT_LIMIT : Math.min(rawLimit, MAX_LIMIT);
  const rawOffset = parseInt(searchParams.get('offset') ?? '0', 10);
  const offset = isNaN(rawOffset) || rawOffset < 0 ? 0 : rawOffset;
  const search = (searchParams.get('search') ?? '').trim();

  const db = getDb();

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

  let rows;
  if (search) {
    const pattern = `%${search}%`;
    rows = await db
      .select(selectedFields)
      .from(users)
      .where(or(ilike(users.email, pattern), ilike(users.displayName, pattern)))
      .orderBy(desc(users.createdAt))
      .limit(limit)
      .offset(offset);
  } else {
    rows = await db
      .select(selectedFields)
      .from(users)
      .orderBy(desc(users.createdAt))
      .limit(limit)
      .offset(offset);
  }

  return NextResponse.json({ users: rows, limit, offset });
}
