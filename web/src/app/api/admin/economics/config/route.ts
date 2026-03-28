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

  const limited = await rateLimitAdminRoute(authResult.ctx.user.id, 'admin-economics-config');
  if (limited) return limited;

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  try {
    const db = getDb();

    if (body.type === 'token_config') {
      if (
        typeof body.tokenCost !== 'number' || !Number.isFinite(body.tokenCost) || body.tokenCost < 0
      ) {
        return NextResponse.json({ error: 'tokenCost must be a non-negative finite number' }, { status: 400 });
      }
      if (
        typeof body.estimatedCostCents !== 'number' || !Number.isFinite(body.estimatedCostCents) || body.estimatedCostCents < 0
      ) {
        return NextResponse.json({ error: 'estimatedCostCents must be a non-negative finite number' }, { status: 400 });
      }
      if (typeof body.id !== 'string' || body.id.trim() === '') {
        return NextResponse.json({ error: 'id is required' }, { status: 400 });
      }
      await db.update(tokenConfig)
        .set({
          tokenCost: body.tokenCost,
          estimatedCostCents: body.estimatedCostCents,
          active: body.active ? 1 : 0,
          updatedAt: new Date(),
        })
        .where(eq(tokenConfig.id, body.id));
    } else if (body.type === 'tier_config') {
      if (
        typeof body.monthlyTokens !== 'number' || !Number.isFinite(body.monthlyTokens) || body.monthlyTokens < 0
      ) {
        return NextResponse.json({ error: 'monthlyTokens must be a non-negative finite number' }, { status: 400 });
      }
      if (
        typeof body.maxProjects !== 'number' || !Number.isFinite(body.maxProjects) || body.maxProjects < 0
      ) {
        return NextResponse.json({ error: 'maxProjects must be a non-negative finite number' }, { status: 400 });
      }
      if (
        typeof body.maxPublished !== 'number' || !Number.isFinite(body.maxPublished) || body.maxPublished < 0
      ) {
        return NextResponse.json({ error: 'maxPublished must be a non-negative finite number' }, { status: 400 });
      }
      if (
        typeof body.priceCentsMonthly !== 'number' || !Number.isFinite(body.priceCentsMonthly) || body.priceCentsMonthly < 0
      ) {
        return NextResponse.json({ error: 'priceCentsMonthly must be a non-negative finite number' }, { status: 400 });
      }
      if (typeof body.id !== 'string' || body.id.trim() === '') {
        return NextResponse.json({ error: 'id is required' }, { status: 400 });
      }
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
    captureException(error, { route: '/api/admin/economics/config', method: 'PUT' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
