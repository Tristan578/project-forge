/**
 * POST /api/generate/model — submit a Meshy 3D model generation job.
 *
 * Deducts tokens upfront on POST. On failure or client-side cancellation,
 * tokens are refunded via the returned `usageId`.
 */

export const maxDuration = 180; // API_MAX_DURATION_HEAVY_GEN_S

import { createGenerationHandler } from '@/lib/api/createGenerationHandler';
import { MeshyClient } from '@/lib/generate/meshyClient';
import { DB_PROVIDER } from '@/lib/config/providers';

export const POST = createGenerationHandler<
  {
    prompt: string;
    mode: 'text-to-3d' | 'image-to-3d';
    quality: 'standard' | 'high';
    imageBase64?: string;
    artStyle?: string;
    negativePrompt?: string;
  },
  {
    jobId: string;
    provider: string;
    status: string;
    estimatedSeconds: number;
    usageId: string | undefined;
  }
>({
  route: '/api/generate/model',
  provider: DB_PROVIDER.model3d,
  operation: (params) =>
    params.mode === 'image-to-3d'
      ? 'image_to_3d'
      : (params.quality === 'high' ? '3d_generation_high' : '3d_generation_standard'),
  rateLimitKey: 'gen-model',
  successStatus: 201,
  billingMetadata: (params) => ({
    prompt: params.prompt,
    mode: params.mode,
    quality: params.quality,
  }),
  validate: (body) => {
    const { prompt, mode, quality = 'standard', imageBase64, artStyle, negativePrompt } = body as Record<string, unknown>;

    if (!prompt || typeof prompt !== 'string' || prompt.length < 3 || prompt.length > 500) {
      return { ok: false, error: 'Prompt must be between 3 and 500 characters' };
    }

    const VALID_MODES = ['text-to-3d', 'image-to-3d'];
    if (!mode || !VALID_MODES.includes(mode as string)) {
      return { ok: false, error: `mode must be one of: ${VALID_MODES.join(', ')}` };
    }

    const VALID_QUALITIES = ['standard', 'high'];
    if (quality !== undefined && !VALID_QUALITIES.includes(quality as string)) {
      return { ok: false, error: `quality must be one of: ${VALID_QUALITIES.join(', ')}` };
    }

    if (mode === 'image-to-3d' && !imageBase64) {
      return { ok: false, error: 'imageBase64 required for image-to-3d mode' };
    }

    if (imageBase64 !== undefined) {
      const MAX_BASE64_CHARS = Math.ceil((10 * 1024 * 1024 * 4) / 3);
      if (typeof imageBase64 !== 'string' || imageBase64.length > MAX_BASE64_CHARS) {
        return { ok: false, error: 'imageBase64 exceeds 10 MB limit', status: 413 };
      }
    }

    return {
      ok: true,
      params: {
        prompt: prompt as string,
        mode: (mode as 'text-to-3d' | 'image-to-3d') ?? 'text-to-3d',
        quality: (quality as string) as 'standard' | 'high',
        imageBase64: imageBase64 as string | undefined,
        artStyle: artStyle as string | undefined,
        negativePrompt: negativePrompt as string | undefined,
      },
    };
  },
  execute: async (params, apiKey, ctx) => {
    const client = new MeshyClient({ apiKey });
    let result: { taskId: string };

    if (params.mode === 'image-to-3d') {
      result = await client.createImageTo3D({
        imageBase64: params.imageBase64!,
        prompt: params.prompt,
      });
    } else {
      result = await client.createTextTo3D({
        prompt: params.prompt,
        artStyle: params.artStyle,
        negativePrompt: params.negativePrompt,
        quality: params.quality,
      });
    }

    return {
      jobId: result.taskId,
      provider: DB_PROVIDER.model3d,
      status: 'pending',
      estimatedSeconds: params.quality === 'high' ? 120 : 60,
      usageId: ctx.usageId,
    };
  },
});
