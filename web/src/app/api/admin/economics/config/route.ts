import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { assertAdmin } from '@/lib/auth/api-auth';
import { withApiMiddleware } from '@/lib/api/middleware';
import { getDb, queryWithResilience } from '@/lib/db/client';
import { tokenConfig, tierConfig } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { rateLimitAdminRoute } from '@/lib/rateLimit';
import { captureException } from '@/lib/monitoring/sentry-server';

const tokenConfigSchema = z.object({
  type: z.literal('token_config'),
  id: z.string().min(1).max(100),
  tokenCost: z.number().finite().min(0),
  estimatedCostCents: z.number().finite().min(0),
  active: z.boolean().optional(),
});

const tierConfigSchema = z.object({
  type: z.literal('tier_config'),
  id: z.string().min(1).max(100),
  monthlyTokens: z.number().finite().min(0),
  maxProjects: z.number().finite().min(0),
  maxPublished: z.number().finite().min(0),
  priceCentsMonthly: z.number().finite().min(0),
});

const economicsConfigSchema = z.discriminatedUnion('type', [
  tokenConfigSchema,
  tierConfigSchema,
]);

export async function PUT(request: NextRequest) {
  const mid = await withApiMiddleware(request, {
    requireAuth: true,
    validate: economicsConfigSchema,
  });
  if (mid.error) return mid.error;
  const { clerkId } = mid.authContext!;

  const adminError = assertAdmin(clerkId);
  if (adminError) return adminError;

  const limited = await rateLimitAdminRoute(mid.userId!, 'admin-economics-config');
  if (limited) return limited;

  const body = mid.body as z.infer<typeof economicsConfigSchema>;

  try {
    if (body.type === 'token_config') {
      const tokenConfigUpdate: {
        tokenCost: number;
        estimatedCostCents: number;
        updatedAt: Date;
        active?: number;
      } = {
        tokenCost: body.tokenCost,
        estimatedCostCents: body.estimatedCostCents,
        updatedAt: new Date(),
      };
      if (body.active !== undefined) {
        tokenConfigUpdate.active = body.active ? 1 : 0;
      }
      await queryWithResilience(() =>
        getDb().update(tokenConfig)
          .set(tokenConfigUpdate)
          .where(eq(tokenConfig.id, body.id))
      );
    } else {
      await queryWithResilience(() =>
        getDb().update(tierConfig)
          .set({
            monthlyTokens: body.monthlyTokens,
            maxProjects: body.maxProjects,
            maxPublished: body.maxPublished,
            priceCentsMonthly: body.priceCentsMonthly,
            updatedAt: new Date(),
          })
          .where(eq(tierConfig.id, body.id))
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    captureException(error, { route: '/api/admin/economics/config', method: 'PUT' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
