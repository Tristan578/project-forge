/**
 * POST /api/generate/sprite — generate a sprite image via DALL-E or SDXL.
 * Returns a data URL and `usageId` for client-side refund on failure.
 */

export const maxDuration = 60; // API_MAX_DURATION_STANDARD_GEN_S

import { createGenerationHandler } from '@/lib/api/createGenerationHandler';
import { SpriteClient } from '@/lib/generate/spriteClient';
import { TOKEN_COSTS } from '@/lib/tokens/pricing';
import { SPRITE_ESTIMATED_SECONDS } from '@/lib/config/providers';

type SpriteProvider = 'dalle3' | 'sdxl';

export const POST = createGenerationHandler<
  {
    prompt: string;
    style?: 'pixel-art' | 'hand-drawn' | 'vector' | 'realistic';
    size: '32x32' | '64x64' | '128x128' | '256x256' | '512x512' | '1024x1024';
    provider: SpriteProvider;
    removeBackground: boolean;
    serviceName: 'openai' | 'replicate';
  },
  {
    jobId: string;
    provider: SpriteProvider;
    status: string;
    estimatedSeconds: number;
    usageId: string | undefined;
  }
>({
  route: '/api/generate/sprite',
  provider: (params) => params.serviceName,
  operation: 'sprite_generation',
  rateLimitKey: 'gen-sprite',
  successStatus: 201,
  tokenCost: (params) =>
    params.provider === 'dalle3'
      ? TOKEN_COSTS.sprite_generation_dalle3
      : TOKEN_COSTS.sprite_generation_replicate,
  validate: (body) => {
    const {
      prompt,
      style,
      size = '64x64',
      provider = 'auto',
      removeBackground = true,
    } = body as Record<string, unknown>;

    if (!prompt || typeof prompt !== 'string' || prompt.length < 3 || prompt.length > 500) {
      return { ok: false, error: 'Prompt must be between 3 and 500 characters' };
    }

    const actualProvider: SpriteProvider =
      provider === 'auto'
        ? (style === 'pixel-art' ? 'sdxl' : 'dalle3')
        : (provider as SpriteProvider);

    const serviceName = actualProvider === 'dalle3' ? 'openai' as const : 'replicate' as const;

    return {
      ok: true,
      params: {
        prompt: prompt as string,
        style: style as 'pixel-art' | 'hand-drawn' | 'vector' | 'realistic' | undefined,
        size: (size as string) as '32x32' | '64x64' | '128x128' | '256x256' | '512x512' | '1024x1024',
        provider: actualProvider,
        removeBackground: removeBackground as boolean,
        serviceName,
      },
    };
  },
  execute: async (params, apiKey, ctx) => {
    const client = new SpriteClient(apiKey, params.provider);
    const result = await client.generateSprite({
      prompt: params.prompt,
      style: params.style,
      size: params.size,
      provider: params.provider,
      removeBackground: params.removeBackground,
    });

    let finalJobId = result.taskId;
    if (params.provider === 'dalle3' && result.status === 'completed') {
      finalJobId = `dalle3:${result.taskId}`;
    }

    return {
      jobId: finalJobId,
      provider: params.provider,
      status: result.status,
      estimatedSeconds: SPRITE_ESTIMATED_SECONDS[params.provider],
      usageId: ctx.usageId,
    };
  },
});
