/**
 * POST /api/generate/texture — generate a texture via DALL-E or Stable Diffusion.
 * Returns a data URL and `usageId` for client-side refund on failure.
 */

export const maxDuration = 60; // API_MAX_DURATION_STANDARD_GEN_S

import { createGenerationHandler } from '@/lib/api/createGenerationHandler';
import { MeshyClient } from '@/lib/generate/meshyClient';
import { DB_PROVIDER } from '@/lib/config/providers';

const ALLOWED_MAP_KEYS = new Set(['normal', 'roughness', 'metallic', 'ao', 'emissive']);

export const POST = createGenerationHandler<
  {
    prompt: string;
    resolution: string;
    style: string;
    tiling: boolean;
    entityId?: string;
    generateMaps?: Record<string, boolean>;
  },
  { jobId: string; provider: string; status: string; estimatedSeconds: number; usageId: string | undefined }
>({
  route: '/api/generate/texture',
  provider: DB_PROVIDER.texture,
  operation: 'texture_generation',
  rateLimitKey: 'gen-texture',
  successStatus: 201,
  validate: (body) => {
    const {
      prompt,
      resolution = '1024',
      style = 'realistic',
      tiling = true,
      entityId,
      generateMaps,
    } = body as Record<string, unknown>;

    // Validate generateMaps
    if (generateMaps !== undefined) {
      if (
        typeof generateMaps !== 'object' ||
        generateMaps === null ||
        Array.isArray(generateMaps) ||
        !Object.values(generateMaps as Record<string, unknown>).every((v) => typeof v === 'boolean')
      ) {
        return {
          ok: false,
          error: 'generateMaps must be an object with boolean values (e.g. { normal: true, roughness: false })',
        };
      }
      const unknownKeys = Object.keys(generateMaps as Record<string, boolean>).filter((k) => !ALLOWED_MAP_KEYS.has(k));
      if (unknownKeys.length > 0) {
        return { ok: false, error: `generateMaps contains unknown keys: ${unknownKeys.join(', ')}` };
      }
    }

    if (!prompt || typeof prompt !== 'string' || prompt.length < 3 || prompt.length > 500) {
      return { ok: false, error: 'Prompt must be between 3 and 500 characters' };
    }

    return {
      ok: true,
      params: {
        prompt: prompt as string,
        resolution: resolution as string,
        style: style as string,
        tiling: tiling as boolean,
        entityId: entityId as string | undefined,
        generateMaps: generateMaps as Record<string, boolean> | undefined,
      },
    };
  },
  execute: async (params, apiKey, ctx) => {
    const client = new MeshyClient({ apiKey });

    const result = await client.createTextToTexture({
      prompt: params.prompt,
      resolution: params.resolution,
      style: params.style,
      tiling: params.tiling,
      generateMaps: params.generateMaps,
    });

    return {
      jobId: result.taskId,
      provider: DB_PROVIDER.texture,
      status: 'pending',
      estimatedSeconds: 60,
      usageId: ctx.usageId,
    };
  },
});
