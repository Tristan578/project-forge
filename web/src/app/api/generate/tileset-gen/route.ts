export const maxDuration = 60; // API_MAX_DURATION_STANDARD_GEN_S

import { createGenerationHandler } from '@/lib/api/createGenerationHandler';
import { SpriteClient } from '@/lib/generate/spriteClient';
import { DB_PROVIDER } from '@/lib/config/providers';

export const POST = createGenerationHandler<
  { prompt: string; tileSize: number; gridSize: string },
  { jobId: string; provider: string; status: string; estimatedSeconds: number }
>({
  route: '/api/generate/tileset-gen',
  provider: DB_PROVIDER.sprite,
  operation: 'tileset_generation',
  rateLimitKey: 'gen-tileset',
  successStatus: 201,
  validate: (body) => {
    const { prompt, tileSize = 32, gridSize = '8x8' } = body as {
      prompt?: unknown;
      tileSize?: unknown;
      gridSize?: unknown;
    };

    if (!prompt || typeof prompt !== 'string' || prompt.length < 3 || prompt.length > 500) {
      return { ok: false, error: 'Prompt must be between 3 and 500 characters' };
    }

    return {
      ok: true,
      params: {
        prompt: prompt as string,
        tileSize: tileSize as number,
        gridSize: gridSize as string,
      },
    };
  },
  execute: async (params, apiKey) => {
    const client = new SpriteClient(apiKey, 'sdxl');
    const result = await client.generateTileset({
      prompt: params.prompt,
      tileSize: params.tileSize,
      gridSize: params.gridSize,
    });

    return {
      jobId: result.taskId,
      provider: DB_PROVIDER.sprite,
      status: result.status,
      estimatedSeconds: 60,
    };
  },
});
