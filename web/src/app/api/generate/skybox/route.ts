/**
 * POST /api/generate/skybox — generate a skybox cubemap via DALL-E or Stable Diffusion.
 * Returns a data URL and `usageId` for client-side refund on failure.
 */

export const maxDuration = 60; // API_MAX_DURATION_STANDARD_GEN_S

import { createGenerationHandler } from '@/lib/api/createGenerationHandler';
import { MeshyClient } from '@/lib/generate/meshyClient';
import { DB_PROVIDER } from '@/lib/config/providers';

export const POST = createGenerationHandler<
  { prompt: string; style: string },
  { jobId: string; provider: string; status: string; estimatedSeconds: number; usageId: string | undefined }
>({
  route: '/api/generate/skybox',
  provider: DB_PROVIDER.texture,
  operation: 'skybox_generation',
  rateLimitKey: 'gen-skybox',
  successStatus: 201,
  validate: (body) => {
    const { prompt, style = 'realistic' } = body as {
      prompt?: unknown;
      style?: unknown;
    };

    if (!prompt || typeof prompt !== 'string' || prompt.length < 3 || prompt.length > 500) {
      return { ok: false, error: 'Prompt must be between 3 and 500 characters' };
    }

    return { ok: true, params: { prompt: prompt as string, style: (style as string) ?? 'realistic' } };
  },
  execute: async (params, apiKey, ctx) => {
    const client = new MeshyClient({ apiKey });

    const result = await client.createTextToTexture({
      prompt: `Equirectangular panorama skybox: ${params.prompt}`,
      resolution: '2048',
      style: params.style,
      tiling: false,
    });

    return {
      jobId: result.taskId,
      provider: DB_PROVIDER.texture,
      status: 'pending',
      estimatedSeconds: 90,
      usageId: ctx.usageId,
    };
  },
});
