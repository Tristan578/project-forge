export const maxDuration = 180; // API_MAX_DURATION_HEAVY_GEN_S

import { createGenerationHandler } from '@/lib/api/createGenerationHandler';
import { ElevenLabsClient } from '@/lib/generate/elevenlabsClient';
import { DB_PROVIDER } from '@/lib/config/providers';
import { withEgressGuard } from '@/lib/security/egressGuard';

/**
 * Music generation (PF-1301 / #9522). Routes to ElevenLabs `/v1/music`, which
 * returns the audio bytes directly — so this route resolves SYNCHRONOUSLY and
 * returns `audioBase64` inline, exactly like the sibling ElevenLabs `sfx` and
 * `voice` routes. There is no provider task id to poll: `GenerateMusicDialog`
 * and the chat `generate_music` tool both consume the inline `audioBase64`
 * branch and attach the track immediately.
 *
 * The async `/api/generate/music/status` route and `pollProviderStatus('music')`
 * are kept as defensive terminal-on-first-poll paths (the client contract still
 * exposes them), but nothing enqueues a music job for polling now — see those
 * files. The Suno provider is gone; `PLATFORM_ELEVENLABS_KEY` covers all three
 * audio capabilities.
 */
const POST_impl = createGenerationHandler<
  { prompt: string; durationSeconds: number; instrumental: boolean },
  { audioBase64: string; durationSeconds: number; provider: string }
>({
  route: '/api/generate/music',
  // Synchronous audio must leave time for a refund before the host stops the
  // request, even when the optional generation-agent flag is disabled.
  maxDurationSeconds: 180,
  enforceRequestDeadline: true,
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

    if (typeof instrumental !== 'boolean') {
      return { ok: false, error: 'Instrumental must be true or false' };
    }

    return {
      ok: true,
      params: {
        prompt: prompt as string,
        durationSeconds: durationSeconds as number,
        instrumental,
      },
    };
  },
  cacheKeyParams: (params) => ({
    prompt: params.prompt,
    durationSeconds: params.durationSeconds,
    instrumental: params.instrumental,
  }),
  execute: async (params, apiKey, ctx) => {
    const client = new ElevenLabsClient({ apiKey });
    const result = await client.generateMusic({
      prompt: params.prompt,
      musicLengthMs: params.durationSeconds * 1000,
      forceInstrumental: params.instrumental,
      signal: ctx.abortSignal,
    });

    return {
      audioBase64: result.audioBase64,
      durationSeconds: result.durationSeconds,
      provider: DB_PROVIDER.music,
    };
  },
});

// Egress guard (#9736): every response this route returns leaves through the
// one redaction chokepoint. See `src/lib/security/egressGuard.ts`.
export const POST = withEgressGuard(POST_impl);
