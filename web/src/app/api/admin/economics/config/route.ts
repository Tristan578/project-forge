import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, assertAdmin } from '@/lib/auth/api-auth';
import { getDb } from '@/lib/db/client';
import { tokenConfig, tierConfig } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { rateLimitAdminRoute } from '@/lib/rateLimit';
import { captureException } from '@/lib/monitoring/sentry-server';

export async function PUT(request: NextRequest) {
  const authResult = await authenticateRequest();
  if (!authResult.ok) return authResult.response;
  const { clerkId } = authResult.ctx;

  const adminError = assertAdmin(clerkId);
  if (adminError) return adminError;

  const limited = await rateLimitAdminRoute(clerkId, 'admin-economics-config');
  if (limited) return limited;

  try {
    const body = await request.json();
    const db = getDb();

    if (body.type === 'token_config') {
      await db.update(tokenConfig)
        .set({
          tokenCost: body.tokenCost,
          estimatedCostCents: body.estimatedCostCents,
          active: body.active ? 1 : 0,
          updatedAt: new Date(),
        })
        .where(eq(tokenConfig.id, body.id));
    } else if (body.type === 'tier_config') {
      await db.update(tierConfig)
        .set({
          monthlyTokens: body.monthlyTokens,
          maxProjects: body.maxProjects,
          maxPublished: body.maxPublished,
          priceCentsMonthly: body.priceCentsMonthly,
          updatedAt: new Date(),
        })
        .where(eq(tierConfig.id, body.id));
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    captureException(error, { route: '/api/admin/economics/config' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
