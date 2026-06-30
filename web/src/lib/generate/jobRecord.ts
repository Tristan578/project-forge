/**
 * Helper to insert a generation job record into the database.
 * Called from each generation API route after the provider returns a task ID.
 */

import { getDb, queryWithResilience } from '@/lib/db/client';
import { generationJobs } from '@/lib/db/schema';

interface CreateJobParams {
  userId: string;
  provider: string;
  providerJobId: string;
  type: 'model' | 'texture' | 'sfx' | 'voice' | 'skybox' | 'music' | 'sprite' | 'sprite_sheet' | 'tileset';
  prompt: string;
  parameters?: Record<string, unknown>;
  tokenCost: number;
  tokenUsageId?: string;
  entityId?: string;
  projectId?: string;
}

export async function createJobRecord(params: CreateJobParams): Promise<string> {
  const [job] = await queryWithResilience(() =>
    getDb()
      .insert(generationJobs)
      .values({
        userId: params.userId,
        projectId: params.projectId ?? null,
        provider: params.provider,
        providerJobId: params.providerJobId,
        type: params.type,
        prompt: params.prompt,
        parameters: params.parameters ?? {},
        tokenCost: params.tokenCost,
        tokenUsageId: params.tokenUsageId ?? null,
        entityId: params.entityId ?? null,
      })
      .returning({ id: generationJobs.id })
  );

  return job.id;
}

/**
 * Mark a job as completed or failed in the database.
 * Called from status endpoints when provider reports final state.
 */
export async function updateJobStatus(
  jobId: string,
  updates: {
    status: 'processing' | 'completed' | 'failed';
    progress?: number;
    resultUrl?: string;
    resultMeta?: Record<string, unknown>;
    errorMessage?: string;
  }
): Promise<void> {
  const setValues: Record<string, unknown> = {
    status: updates.status,
    updatedAt: new Date(),
  };

  if (typeof updates.progress === 'number') setValues.progress = updates.progress;
  if (updates.resultUrl !== undefined) setValues.resultUrl = updates.resultUrl;
  if (updates.resultMeta !== undefined) setValues.resultMeta = updates.resultMeta;
  if (updates.errorMessage !== undefined) setValues.errorMessage = updates.errorMessage;

  if (updates.status === 'completed' || updates.status === 'failed') {
    setValues.completedAt = new Date();
  }

  const { eq } = await import('drizzle-orm');
  await queryWithResilience(() =>
    getDb()
      .update(generationJobs)
      .set(setValues)
      .where(eq(generationJobs.id, jobId))
  );
}

/**
 * Finalize a job identified by its provider job id + owner, but ONLY while it
 * is still non-terminal. Used by the durable QStash callback (PF-906, #8816),
 * which has no DB row id (the client created the row keyed on providerJobId).
 *
 * Two safety properties:
 * - The `status NOT IN (completed/failed/cancelled)` guard means the callback
 *   can never clobber a result a live client already imported — whichever path
 *   finalizes first wins, the other affects 0 rows.
 * - A missing row (the user closed the tab before the client ever POSTed
 *   `/api/jobs`) simply affects 0 rows; it is NOT an error, because the
 *   refund-on-failure is keyed on the token usage id, not this row.
 */
export async function updateJobStatusByProviderJob(
  providerJobId: string,
  userId: string,
  updates: {
    status: 'processing' | 'completed' | 'failed';
    progress?: number;
    resultUrl?: string;
    resultMeta?: Record<string, unknown>;
    errorMessage?: string;
  }
): Promise<void> {
  const setValues: Record<string, unknown> = {
    status: updates.status,
    updatedAt: new Date(),
  };

  if (typeof updates.progress === 'number') setValues.progress = updates.progress;
  if (updates.resultUrl !== undefined) setValues.resultUrl = updates.resultUrl;
  if (updates.resultMeta !== undefined) setValues.resultMeta = updates.resultMeta;
  if (updates.errorMessage !== undefined) setValues.errorMessage = updates.errorMessage;

  if (updates.status === 'completed' || updates.status === 'failed') {
    setValues.completedAt = new Date();
    // NOTE: `imported` is intentionally left untouched. It tracks whether the
    // client actually imported the asset into the editor; finalizing status
    // server-side does not import anything.
  }

  const { and, eq, notInArray } = await import('drizzle-orm');
  await queryWithResilience(() =>
    getDb()
      .update(generationJobs)
      .set(setValues)
      .where(
        and(
          eq(generationJobs.providerJobId, providerJobId),
          eq(generationJobs.userId, userId),
          notInArray(generationJobs.status, ['completed', 'failed', 'cancelled']),
        )
      )
  );
}
