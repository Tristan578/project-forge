import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { generationResultUrlSchema } from '@/lib/generation/resultUrl';
import { getDb, queryWithResilience } from '@/lib/db/client';
import { generationJobs } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { withApiMiddleware } from '@/lib/api/middleware';
import { captureException } from '@/lib/monitoring/sentry-server';
import { redactedJson } from '@/lib/api/errors';
import { withEgressGuard } from '@/lib/security/egressGuard';

export const dynamic = 'force-dynamic';

const patchJobSchema = z.object({
  status: z.enum(['pending', 'processing', 'downloading', 'completed', 'failed', 'cancelled']).optional(),
  progress: z.number().finite().min(0).max(100).optional(),
  errorMessage: z.string().max(2000).nullish(),
  resultUrl: generationResultUrlSchema.nullish(),
  resultMeta: z.record(z.string(), z.unknown()).nullish(),
  imported: z.boolean().optional(),
});

/**
 * PATCH: Update an owned job. Optional status/progress (0–100), errorMessage
 * (at most 2000 chars), resultMeta and imported synchronize polling/import.
 * resultUrl is optional/null: HTTP URL at most 2000 chars or non-empty PNG
 * data URL at most 4 MiB characters, sharing initial POST artifact validation.
 * Returns 200 {updated:true}; middleware handles auth/rate/validation errors,
 * a missing or unowned id returns 404, and database failures return fixed 500.
 * Refund ownership remains server-side; refunded is not accepted here.
 */
async function PATCH_impl(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const mid = await withApiMiddleware(req, {
      requireAuth: true,
      rateLimit: true,
      rateLimitConfig: { key: (id) => `user:job-update:${id}`, max: 60, windowSeconds: 60, distributed: false },
      validate: patchJobSchema,
    });
    if (mid.error) return mid.error;

    const { id } = await params;
    const body = mid.body as z.infer<typeof patchJobSchema>;

    // Verify ownership
    const [existing] = await queryWithResilience(() =>
      getDb()
        .select({ id: generationJobs.id })
        .from(generationJobs)
        .where(and(eq(generationJobs.id, id), eq(generationJobs.userId, mid.userId!)))
        .limit(1)
    );

    if (!existing) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    // Build update object
    const updates: Record<string, unknown> = { updatedAt: new Date() };

    if (body.status !== undefined) updates.status = body.status;
    if (body.progress !== undefined) updates.progress = body.progress;
    if (body.errorMessage !== undefined) updates.errorMessage = body.errorMessage;
    if (body.resultUrl !== undefined) updates.resultUrl = body.resultUrl;
    if (body.resultMeta !== undefined) updates.resultMeta = body.resultMeta;
    if (body.imported !== undefined) updates.imported = body.imported ? 1 : 0;
    // refunded field intentionally omitted — only server-side refundTokens() may set this

    if (body.status === 'completed' || body.status === 'failed') {
      updates.completedAt = new Date();
    }

    await queryWithResilience(() =>
      getDb()
        .update(generationJobs)
        .set(updates)
        .where(eq(generationJobs.id, id))
    );

    return NextResponse.json({ updated: true });
  } catch (error) {
    console.error('Failed to update job:', error);
    captureException(error, { route: '/api/jobs/[id]', method: 'PATCH' });
    return redactedJson(
      { error: 'Failed to update job' },
      { status: 500 }
    );
  }
}

// Egress guard (#9736): every response this route returns leaves through the
// one redaction chokepoint. See `src/lib/security/egressGuard.ts`.
export const PATCH = withEgressGuard(PATCH_impl);


/**
 * GET: Retrieve one saved artifact by job id for the authenticated owner.
 * Returns HTTP 200 {resultUrl} (bounded HTTP URL or inline PNG). Middleware
 * returns 401/429 for authentication/rate errors, missing or unowned jobs
 * return 404, invalid/oversized historical artifacts return 422, and query
 * failures return a fixed 500 body. No generation or token charge occurs.
 */
async function GET_impl(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const mid = await withApiMiddleware(req, {
      requireAuth: true, rateLimit: true,
      rateLimitConfig: { key: (id) => `user:job-result:${id}`, max: 60, windowSeconds: 60, distributed: false },
    });
    if (mid.error) return mid.error;
    const { id } = await params;
    const [job] = await queryWithResilience(() => getDb()
      .select({ resultUrl: generationJobs.resultUrl })
      .from(generationJobs)
      .where(and(eq(generationJobs.id, id), eq(generationJobs.userId, mid.userId!)))
      .limit(1));
    if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    // Enforce the same bound for historical rows before writing the response.
    const result = generationResultUrlSchema.safeParse(job.resultUrl);
    if (!result.success) return NextResponse.json({ error: 'Saved artifact is unavailable' }, { status: 422 });
    return redactedJson({ resultUrl: result.data });
  } catch (error) {
    captureException(error, { route: '/api/jobs/[id]', method: 'GET' });
    return redactedJson({ error: 'Failed to fetch saved artifact' }, { status: 500 });
  }
}

/** Authenticated artifact retrieval, redacted through the egress guard. */
export const GET = withEgressGuard(GET_impl);
