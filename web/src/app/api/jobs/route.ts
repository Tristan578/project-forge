import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { generationResultUrlSchema } from '@/lib/generation/resultUrl';
import { getDb, queryWithResilience } from '@/lib/db/client';
import { generationJobs } from '@/lib/db/schema';
import { eq, and, inArray, desc, sql } from 'drizzle-orm';
import { withApiMiddleware } from '@/lib/api/middleware';
import { captureException } from '@/lib/monitoring/sentry-server';
import { redactedJson } from '@/lib/api/errors';
import { withEgressGuard } from '@/lib/security/egressGuard';

export const dynamic = 'force-dynamic';

const createJobSchema = z.object({
  providerJobId: z.string().min(1).max(200),
  provider: z.string().min(1).max(100),
  type: z.enum(['sprite', 'texture', 'model', 'sfx', 'voice', 'skybox', 'music', 'sprite_sheet', 'tileset']),
  prompt: z.string().min(1).max(2000),
  parameters: z.record(z.string(), z.unknown()).optional(),
  resultUrl: generationResultUrlSchema.optional(),
  tokenCost: z.number().int().min(0).optional(),
  tokenUsageId: z.string().max(100).nullish(),
  entityId: z.string().max(100).nullish(),
});

/**
 * POST: Persist an authenticated user's generation job after submission.
 * Requires providerJobId (1–200 chars), provider (1–100), supported type, and
 * prompt (1–2000; stored at most 500). Optional parameters store placement and
 * metadata; tokenCost defaults to 0, tokenUsageId/entityId may be null.
 * Optional resultUrl preserves an inline synchronous artifact: HTTP URL at
 * most 2000 chars or non-empty PNG data URL at most 4 MiB characters.
 * Returns HTTP 201 {job:{id}}; auth/rate/validation errors use middleware,
 * and persistence failures return a fixed 500 response.
 */
async function POST_impl(req: NextRequest) {
  try {
    const mid = await withApiMiddleware(req, {
      requireAuth: true,
      rateLimit: true,
      rateLimitConfig: { key: (id) => `jobs:${id}`, max: 30, windowSeconds: 60, distributed: false },
      validate: createJobSchema,
    });
    if (mid.error) return mid.error;

    const { providerJobId, provider, type, prompt, parameters, tokenCost, tokenUsageId, entityId, resultUrl } =
      mid.body as z.infer<typeof createJobSchema>;

    const [job] = await queryWithResilience(() =>
      getDb()
        .insert(generationJobs)
        .values({
          userId: mid.userId!,
          providerJobId,
          provider,
          type,
          prompt: prompt.slice(0, 500),
          parameters: parameters ?? {},
          tokenCost: tokenCost ?? 0,
          tokenUsageId: tokenUsageId ?? null,
          entityId: entityId ?? null,
          resultUrl: resultUrl ?? null,
        })
        .returning()
    );

    return NextResponse.json({ job: { id: job.id } }, { status: 201 });
  } catch (error) {
    captureException(error, { route: '/api/jobs', method: 'POST' });
    return redactedJson(
      { error: 'Failed to create job' },
      { status: 500 }
    );
  }
}

/**
 * GET: List up to 50 owned jobs, newest first. status=active selects pending,
 * processing and downloading; all or an absent status includes every state.
 * HTTP 200 {jobs} retains HTTP resultUrl values, but inline artifacts are
 * excluded in SQL and represented by resultUrl:null, hasInlineResult:true.
 * Fetch each flagged artifact with GET /api/jobs/{id} during recovery.
 * Authentication errors use middleware; query failures return fixed HTTP 500.
 */
async function GET_impl(req: NextRequest) {
  try {
    const mid = await withApiMiddleware(req, { requireAuth: true });
    if (mid.error) return mid.error;

    const searchParams = req.nextUrl.searchParams;
    const statusFilter = searchParams.get('status'); // 'active' | 'all' | specific status

    let conditions;
    if (statusFilter === 'active') {
      conditions = and(
        eq(generationJobs.userId, mid.userId!),
        inArray(generationJobs.status, ['pending', 'processing', 'downloading'])
      );
    } else if (statusFilter && statusFilter !== 'all') {
      conditions = and(
        eq(generationJobs.userId, mid.userId!),
        eq(generationJobs.status, statusFilter as 'pending' | 'processing' | 'downloading' | 'completed' | 'failed' | 'cancelled')
      );
    } else {
      conditions = eq(generationJobs.userId, mid.userId!);
    }

    const jobs = await queryWithResilience(() =>
      getDb()
        .select({
          id: generationJobs.id, providerJobId: generationJobs.providerJobId,
          provider: generationJobs.provider, type: generationJobs.type,
          prompt: generationJobs.prompt, parameters: generationJobs.parameters,
          status: generationJobs.status, progress: generationJobs.progress,
          errorMessage: generationJobs.errorMessage,
          // Keep potentially multi-MB PNGs inside the database, not this list.
          resultUrl: sql<string | null>`CASE WHEN ${generationJobs.resultUrl} LIKE 'data:%' THEN NULL ELSE ${generationJobs.resultUrl} END`,
          hasInlineResult: sql<boolean>`COALESCE(${generationJobs.resultUrl} LIKE 'data:%', FALSE)`,
          resultMeta: generationJobs.resultMeta, imported: generationJobs.imported,
          tokenCost: generationJobs.tokenCost, tokenUsageId: generationJobs.tokenUsageId,
          entityId: generationJobs.entityId, createdAt: generationJobs.createdAt,
          updatedAt: generationJobs.updatedAt, completedAt: generationJobs.completedAt,
        })
        .from(generationJobs)
        .where(conditions)
        .orderBy(desc(generationJobs.createdAt))
        .limit(50)
    );

    // STORE-AND-FORWARD (#9736). `errorMessage` below is a persisted column,
    // written by `webhooks/generation-complete` and by this route's own PATCH.
    // Every value written today is a fixed string, but this is a channel the
    // catch-path lint rule structurally CANNOT see: a route can satisfy that
    // rule and still return caught-error text a different route wrote earlier,
    // possibly months ago. Redacting on the way out is the only control that
    // covers rows already in the table.
    return redactedJson({
      jobs: jobs.map((j) => ({
        id: j.id,
        providerJobId: j.providerJobId,
        provider: j.provider,
        type: j.type,
        prompt: j.prompt,
        parameters: j.parameters,
        status: j.status,
        progress: j.progress,
        errorMessage: j.errorMessage,
        // Inline artifacts are fetched individually; multiple PNGs would exceed
        // the host response limit in this list (for example character poses).
        resultUrl: j.resultUrl?.startsWith('data:') ? null : j.resultUrl,
        hasInlineResult: j.hasInlineResult,
        resultMeta: j.resultMeta,
        imported: j.imported === 1,
        tokenCost: j.tokenCost,
        tokenUsageId: j.tokenUsageId,
        entityId: j.entityId,
        createdAt: j.createdAt.toISOString(),
        updatedAt: j.updatedAt.toISOString(),
        completedAt: j.completedAt?.toISOString() ?? null,
      })),
    });
  } catch (error) {
    captureException(error, { route: '/api/jobs', method: 'GET' });
    return redactedJson(
      { error: 'Failed to fetch jobs' },
      { status: 500 }
    );
  }
}

// Egress guard (#9736): every response this route returns leaves through the
// one redaction chokepoint. See `src/lib/security/egressGuard.ts`.
export const POST = withEgressGuard(POST_impl);
export const GET = withEgressGuard(GET_impl);
