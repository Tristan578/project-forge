export const maxDuration = 60; // API_MAX_DURATION_STANDARD_GEN_S

import { createGenerationHandler } from '@/lib/api/createGenerationHandler';
import { ElevenLabsClient } from '@/lib/generate/elevenlabsClient';
import { DB_PROVIDER } from '@/lib/config/providers';

export const POST = createGenerationHandler<
  { prompt: string; durationSeconds: number },
  { audioBase64: string; durationSeconds: number; provider: string }
>({
  route: '/api/generate/sfx',
  provider: DB_PROVIDER.sfx,
  operation: 'sfx_generation',
  rateLimitKey: 'gen-sfx',
  validate: (body) => {
    const { prompt, durationSeconds = 5 } = body as {
      prompt?: unknown;
      durationSeconds?: unknown;
    };

    if (!prompt || typeof prompt !== 'string' || prompt.length < 3 || prompt.length > 500) {
      return { ok: false, error: 'Prompt must be between 3 and 500 characters' };
    }

    if (typeof durationSeconds !== 'number' || !Number.isFinite(durationSeconds) || durationSeconds < 0.5 || durationSeconds > 22) {
      return { ok: false, error: 'Duration must be between 0.5 and 22 seconds' };
    }

    return { ok: true, params: { prompt: prompt as string, durationSeconds: durationSeconds as number } };
  },
  execute: async (params, apiKey) => {
    const client = new ElevenLabsClient({ apiKey });
    const result = await client.generateSfx({
      prompt: params.prompt,
      durationSeconds: params.durationSeconds,
    });

    return {
      audioBase64: result.audioBase64,
      durationSeconds: result.durationSeconds,
      provider: DB_PROVIDER.sfx,
    };
  },
});
