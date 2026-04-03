export const maxDuration = 60; // API_MAX_DURATION_STANDARD_GEN_S

import { createGenerationHandler } from '@/lib/api/createGenerationHandler';
import { SpriteClient } from '@/lib/generate/spriteClient';
import { TOKEN_COSTS } from '@/lib/tokens/pricing';
import { DB_PROVIDER } from '@/lib/config/providers';

export const POST = createGenerationHandler<
  {
    prompt: string;
    frameCount: number;
    style?: string;
    size: string;
  },
  { jobId: string; provider: string; status: string; estimatedSeconds: number }
>({
  route: '/api/generate/sprite-sheet',
  provider: DB_PROVIDER.sprite,
  operation: 'sprite_sheet_generation',
  rateLimitKey: 'gen-spritesheet',
  successStatus: 201,
  tokenCost: (params) => params.frameCount * TOKEN_COSTS.sprite_sheet_cost_per_frame,
  validate: (body) => {
    const {
      prompt,
      frameCount = 4,
      style,
      size = '64x64',
    } = body as {
      prompt?: unknown;
      frameCount?: unknown;
      style?: unknown;
      size?: unknown;
    };

    if (typeof prompt !== 'string' || !prompt || prompt.trim().length < 3) {
      return { ok: false, error: 'prompt is required (min 3 characters)' };
    }

    if (typeof frameCount !== 'number' || frameCount < 2 || frameCount > 8) {
      return { ok: false, error: 'frameCount must be between 2 and 8' };
    }

    return {
      ok: true,
      params: {
        prompt: (prompt as string).trim(),
        frameCount: frameCount as number,
        style: style as string | undefined,
        size: size as string,
      },
    };
  },
  execute: async (params, apiKey) => {
    const client = new SpriteClient(apiKey, 'sdxl');
    const result = await client.generateSpriteSheet({
      prompt: params.prompt,
      frameCount: params.frameCount,
      style: params.style,
      size: params.size,
    });

    return {
      jobId: result.taskId,
      provider: DB_PROVIDER.sprite,
      status: result.status,
      estimatedSeconds: params.frameCount * 10,
    };
  },
});
