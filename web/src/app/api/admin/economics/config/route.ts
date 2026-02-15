import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { getDb } from '@/lib/db/client';
import { tokenConfig, tierConfig } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';

export async function PUT(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

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
