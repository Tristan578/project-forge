import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db/client';
import { generationJobs } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { rateLimit, rateLimitResponse } from '@/lib/rateLimit';
import { captureException } from '@/lib/monitoring/sentry-server';

export const dynamic = 'force-dynamic';

// PATCH: Update job status (used by polling to sync provider status to DB)
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await authenticateRequest();
    if (!authResult.ok) return authResult.response;

    const rl = await rateLimit(`user:job-update:${authResult.ctx.user.id}`, 60, 60_000);
    if (!rl.allowed) return rateLimitResponse(rl.remaining, rl.resetAt);

    const { id } = await params;
    const body = await req.json();

    const db = getDb();

    // Verify ownership
    const [existing] = await db
      .select({ id: generationJobs.id })
      .from(generationJobs)
      .where(and(eq(generationJobs.id, id), eq(generationJobs.userId, authResult.ctx.user.id)))
      .limit(1);

    if (!existing) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    // Build update object
    const updates: Record<string, unknown> = { updatedAt: new Date() };

    const VALID_STATUSES = ['pending', 'processing', 'downloading', 'completed', 'failed', 'cancelled'] as const;
    if (body.status !== undefined) {
      if (!VALID_STATUSES.includes(body.status)) {
        return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
      }
      updates.status = body.status;
    }
    if (typeof body.progress === 'number') updates.progress = body.progress;
    if (body.errorMessage !== undefined) updates.errorMessage = body.errorMessage;
    if (body.resultUrl !== undefined) updates.resultUrl = body.resultUrl;
    if (body.resultMeta !== undefined) updates.resultMeta = body.resultMeta;
    if (typeof body.imported === 'boolean') updates.imported = body.imported ? 1 : 0;
    if (typeof body.refunded === 'boolean') updates.refunded = body.refunded ? 1 : 0;

    if (body.status === 'completed' || body.status === 'failed') {
      updates.completedAt = new Date();
    }

    await db
      .update(generationJobs)
      .set(updates)
      .where(eq(generationJobs.id, id));

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
