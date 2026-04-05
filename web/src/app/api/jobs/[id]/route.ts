import { NextRequest, NextResponse } from 'next/server';
import { getDb, queryWithResilience } from '@/lib/db/client';
import { generationJobs } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { withApiMiddleware } from '@/lib/api/middleware';
import { captureException } from '@/lib/monitoring/sentry-server';

export const dynamic = 'force-dynamic';

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
    });
    if (mid.error) return mid.error;

    const { id } = await params;
    const body = await req.json();

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

    const VALID_STATUSES = ['pending', 'processing', 'downloading', 'completed', 'failed', 'cancelled'] as const;
    if (body.status) {
      if (!VALID_STATUSES.includes(body.status)) {
        return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
      }
      updates.status = body.status;
    }
    if (typeof body.progress === 'number') {
      if (!Number.isFinite(body.progress) || body.progress < 0 || body.progress > 100) {
        return NextResponse.json({ error: 'progress must be a finite number between 0 and 100' }, { status: 400 });
      }
      updates.progress = body.progress;
    }
    if (body.errorMessage !== undefined) updates.errorMessage = body.errorMessage;
    if (body.resultUrl !== undefined) updates.resultUrl = body.resultUrl;
    if (body.resultMeta !== undefined) updates.resultMeta = body.resultMeta;
    if (typeof body.imported === 'boolean') updates.imported = body.imported ? 1 : 0;
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
