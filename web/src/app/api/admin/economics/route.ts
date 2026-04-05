import { NextRequest, NextResponse } from 'next/server';
import { assertAdmin } from '@/lib/auth/api-auth';
import { withApiMiddleware } from '@/lib/api/middleware';
import { rateLimitAdminRoute } from '@/lib/rateLimit';
import { getDb } from '@/lib/db/client';
import { users, costLog, creditTransactions, tokenConfig, tierConfig } from '@/lib/db/schema';
import { sql, count, sum, desc } from 'drizzle-orm';
import { captureException } from '@/lib/monitoring/sentry-server';

export async function GET(req: NextRequest) {
  const mid = await withApiMiddleware(req, { requireAuth: true });
  if (mid.error) return mid.error;
  const { clerkId } = mid.authContext!;

  const adminError = assertAdmin(clerkId);
  if (adminError) return adminError;

  const rateLimitError = await rateLimitAdminRoute(clerkId, 'admin-economics');
  if (rateLimitError) return rateLimitError;

  try {
  const db = getDb();

  // Overview stats
  const [userStats] = await db.select({
    totalUsers: count(),
    starterCount: count(sql`CASE WHEN ${users.tier} = 'starter' THEN 1 END`),
    hobbyistCount: count(sql`CASE WHEN ${users.tier} = 'hobbyist' THEN 1 END`),
    creatorCount: count(sql`CASE WHEN ${users.tier} = 'creator' THEN 1 END`),
    proCount: count(sql`CASE WHEN ${users.tier} = 'pro' THEN 1 END`),
  }).from(users);

  // Cost summary (last 30 days)
  const costSummary = await db.select({
    actionType: costLog.actionType,
    provider: costLog.provider,
    totalCost: sum(costLog.actualCostCents),
    totalTokens: sum(costLog.tokensCharged),
    count: count(),
  })
    .from(costLog)
    .where(sql`${costLog.createdAt} > NOW() - INTERVAL '30 days'`)
    .groupBy(costLog.actionType, costLog.provider)
    .orderBy(desc(sql`${sum(costLog.tokensCharged)}`));

  // Recent transactions
  const recentTransactions = await db.select()
    .from(creditTransactions)
    .orderBy(desc(creditTransactions.createdAt))
    .limit(50);

  // Token config
  const tokenConfigs = await db.select().from(tokenConfig);

  // Tier config
  const tierConfigs = await db.select().from(tierConfig);

  return NextResponse.json({
    userStats,
    costSummary,
    recentTransactions,
    tokenConfigs,
    tierConfigs,
  });
  } catch (error) {
    captureException(error, { route: '/api/admin/economics' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
