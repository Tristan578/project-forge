/**
 * Helper to insert a generation job record into the database.
 * Called from each generation API route after the provider returns a task ID.
 */

import { getDb } from '@/lib/db/client';
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
  const db = getDb();

  const [job] = await db
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
    .returning({ id: generationJobs.id });

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
  const db = getDb();

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

  // Find by provider job ID (not DB id) — this is what we have from provider responses
  const { eq } = await import('drizzle-orm');
  await db
    .update(generationJobs)
    .set(setValues)
    .where(eq(generationJobs.id, jobId));
}
