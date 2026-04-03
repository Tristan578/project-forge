export const maxDuration = 60; // API_MAX_DURATION_STANDARD_GEN_S

import { createGenerationHandler } from '@/lib/api/createGenerationHandler';
import { ElevenLabsClient } from '@/lib/generate/elevenlabsClient';
import { DB_PROVIDER } from '@/lib/config/providers';

const VOICE_STYLE_MAP: Record<string, number> = {
  neutral: 0,
  friendly: 0.3,
  calm: 0.2,
  excited: 1.0,
  sinister: 0.7,
};

export const POST = createGenerationHandler<
  {
    text: string;
    voiceId?: string;
    stability?: number;
    similarityBoost?: number;
    style?: number;
  },
  { audioBase64: string; durationSeconds: number; provider: string }
>({
  route: '/api/generate/voice',
  provider: DB_PROVIDER.voice,
  operation: 'voice_generation',
  rateLimitKey: 'gen-voice',
  promptField: 'text',
  validate: (body) => {
    const { text, voiceId, stability, similarityBoost, voiceStyle } = body as Record<string, unknown>;
    let style = body.style as number | undefined;

    // Validate voiceId
    if (voiceId !== undefined) {
      if (typeof voiceId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(voiceId)) {
        return { ok: false, error: 'voiceId must be an alphanumeric string up to 64 characters' };
      }
    }

    // Validate numeric voice params
    if (stability !== undefined) {
      if (typeof stability !== 'number' || !Number.isFinite(stability) || stability < 0 || stability > 1) {
        return { ok: false, error: 'stability must be a number between 0.0 and 1.0' };
      }
    }
    if (similarityBoost !== undefined) {
      if (typeof similarityBoost !== 'number' || !Number.isFinite(similarityBoost) || similarityBoost < 0 || similarityBoost > 1) {
        return { ok: false, error: 'similarityBoost must be a number between 0.0 and 1.0' };
      }
    }
    if (style !== undefined) {
      if (typeof style !== 'number' || !Number.isFinite(style) || style < 0 || style > 1) {
        return { ok: false, error: 'style must be a number between 0.0 and 1.0' };
      }
    }

    // Map voiceStyle string to numeric style
    if (voiceStyle && typeof voiceStyle === 'string') {
      style = VOICE_STYLE_MAP[voiceStyle] ?? 0;
    }

    // Validate text
    if (!text || typeof text !== 'string' || text.length < 1 || text.length > 1000) {
      return { ok: false, error: 'Text must be between 1 and 1000 characters' };
    }

    return {
      ok: true,
      params: {
        text: text as string,
        voiceId: voiceId as string | undefined,
        stability: stability as number | undefined,
        similarityBoost: similarityBoost as number | undefined,
        style,
      },
    };
  },
  execute: async (params, apiKey) => {
    const client = new ElevenLabsClient({ apiKey });
    const result = await client.generateVoice({
      text: params.text,
      voiceId: params.voiceId,
      stability: params.stability,
      similarityBoost: params.similarityBoost,
      style: params.style,
    });

    return {
      audioBase64: result.audioBase64,
      durationSeconds: result.durationSeconds,
      provider: DB_PROVIDER.voice,
    };
  },
});
