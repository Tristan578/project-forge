import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, assertAdmin } from '@/lib/auth/api-auth';
import { getDb } from '@/lib/db/client';
import { tokenConfig, tierConfig } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export async function PUT(request: NextRequest) {
  const authResult = await authenticateRequest();
  if (!authResult.ok) return authResult.response;
  const { clerkId } = authResult.ctx;

  const adminError = assertAdmin(clerkId);
  if (adminError) return adminError;

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
}
