import { NextRequest, NextResponse } from 'next/server';
import { getDb, queryWithResilience } from '@/lib/db/client';
import { generationJobs } from '@/lib/db/schema';
import { eq, and, inArray, desc } from 'drizzle-orm';
import { withApiMiddleware } from '@/lib/api/middleware';
import { captureException } from '@/lib/monitoring/sentry-server';

export const dynamic = 'force-dynamic';

// POST: Create a job record (called by client after generation API returns)
export async function POST(req: NextRequest) {
  try {
    const mid = await withApiMiddleware(req, {
      requireAuth: true,
      rateLimit: true,
      rateLimitConfig: { key: (id) => `jobs:${id}`, max: 30, windowSeconds: 60, distributed: false },
    });
    if (mid.error) return mid.error;

    const body = await req.json();
    const { providerJobId, provider, type, prompt, parameters, tokenCost, tokenUsageId, entityId } = body;

    if (!providerJobId || !provider || !type || !prompt) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const db = getDb();

    const [job] = await db
      .insert(generationJobs)
      .values({
        userId: mid.userId!,
        providerJobId,
        provider,
        type,
        prompt: String(prompt).slice(0, 500),
        parameters: parameters ?? {},
        tokenCost: typeof tokenCost === 'number' ? tokenCost : 0,
        tokenUsageId: tokenUsageId ?? null,
        entityId: entityId ?? null,
      })
      .returning();

    return NextResponse.json({ job: { id: job.id } }, { status: 201 });
  } catch (error) {
    captureException(error, { route: '/api/jobs', method: 'POST' });
    return NextResponse.json(
      { error: 'Failed to create job' },
      { status: 500 }
    );
  }
}

// GET: Fetch user's active (in-progress) jobs for hydration on page load
export async function GET(req: NextRequest) {
  try {
    const mid = await withApiMiddleware(req, { requireAuth: true });
    if (mid.error) return mid.error;

    const db = getDb();
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

    const jobs = await db
      .select()
      .from(generationJobs)
      .where(conditions)
      .orderBy(desc(generationJobs.createdAt))
      .limit(50);

    return NextResponse.json({
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
        resultUrl: j.resultUrl,
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
    return NextResponse.json(
      { error: 'Failed to fetch jobs' },
      { status: 500 }
    );
  }
}
