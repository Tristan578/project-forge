import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getDb, queryWithResilience } from '@/lib/db/client';
import { generationJobs } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { withApiMiddleware } from '@/lib/api/middleware';
import { captureException } from '@/lib/monitoring/sentry-server';

export const dynamic = 'force-dynamic';

const patchJobSchema = z.object({
  status: z.enum(['pending', 'processing', 'downloading', 'completed', 'failed', 'cancelled']).optional(),
  progress: z.number().finite().min(0).max(100).optional(),
  errorMessage: z.string().max(2000).nullish(),
  resultUrl: z.string().max(2000).nullish(),
  resultMeta: z.record(z.string(), z.unknown()).nullish(),
  imported: z.boolean().optional(),
});

// PATCH: Update job status (used by polling to sync provider status to DB)
export async function PATCH(
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
    return NextResponse.json(
      { error: 'Failed to update job' },
      { status: 500 }
    );
  }
}
