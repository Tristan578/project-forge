export const maxDuration = 180; // API_MAX_DURATION_HEAVY_GEN_S

import { createGenerationHandler } from '@/lib/api/createGenerationHandler';
import { SunoClient } from '@/lib/generate/sunoClient';
import { DB_PROVIDER } from '@/lib/config/providers';

export const POST = createGenerationHandler<
  { prompt: string; durationSeconds: number; instrumental: boolean },
  { jobId: string; provider: string; status: string; estimatedSeconds: number; usageId: string | undefined }
>({
  route: '/api/generate/music',
  provider: DB_PROVIDER.music,
  operation: 'music_generation',
  rateLimitKey: 'gen-music',
  successStatus: 201,
  validate: (body) => {
    const { prompt, durationSeconds = 30, instrumental = true } = body as {
      prompt?: unknown;
      durationSeconds?: unknown;
      instrumental?: unknown;
    };

    if (!prompt || typeof prompt !== 'string' || prompt.length < 3 || prompt.length > 500) {
      return { ok: false, error: 'Prompt must be between 3 and 500 characters' };
    }

    if (!(typeof durationSeconds === 'number' && Number.isFinite(durationSeconds)) || durationSeconds < 15 || durationSeconds > 120) {
      return { ok: false, error: 'Duration must be between 15 and 120 seconds' };
    }

    return {
      ok: true,
      params: {
        prompt: prompt as string,
        durationSeconds: durationSeconds as number,
        instrumental: instrumental as boolean,
      },
    };
  },
  execute: async (params, apiKey, ctx) => {
    const client = new SunoClient({ apiKey });
    const result = await client.createMusic({
      prompt: params.prompt,
      durationSeconds: params.durationSeconds,
      instrumental: params.instrumental,
    });

    return {
      jobId: result.taskId,
      provider: DB_PROVIDER.music,
      status: 'pending',
      estimatedSeconds: 60,
      usageId: ctx.usageId,
    };
  },
});
