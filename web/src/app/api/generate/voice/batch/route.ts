export const maxDuration = 120; // API_MAX_DURATION_BATCH_S

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withApiMiddleware } from '@/lib/api/middleware';
import { resolveApiKey, ApiKeyError } from '@/lib/keys/resolver';
import { ElevenLabsClient } from '@/lib/generate/elevenlabsClient';
import { rateLimitResponse } from '@/lib/rateLimit';
import { distributedRateLimit, aggregateGenerationRateLimit } from '@/lib/rateLimit/distributed';
import { captureException } from '@/lib/monitoring/sentry-server';
import { refundTokens, refundTokenAmount } from '@/lib/tokens/service';
import { TOKEN_COSTS } from '@/lib/tokens/pricing';
import { sanitizePrompt } from '@/lib/ai/contentSafety';

const voiceBatchSchema = z.object({
  items: z
    .array(
      z.object({
        nodeId: z.string().min(1).max(200),
        text: z.string().min(1).max(1000),
        speaker: z.string().max(200),
      }),
    )
    .min(1)
    .max(20),
  voiceSettings: z.object({
    voiceId: z.string().min(1).max(200),
    stability: z.number().finite().min(0).max(1),
    similarityBoost: z.number().finite().min(0).max(1),
    style: z.number().finite().min(0).max(1),
  }),
});

export async function POST(request: NextRequest) {
  const mid = await withApiMiddleware(request, {
    requireAuth: true,
    validate: voiceBatchSchema,
  });
  if (mid.error) return mid.error;

  // Aggregate rate limit across ALL generation routes (30 req / 15 min per user)
  const aggRl = await aggregateGenerationRateLimit(mid.userId!);
  if (!aggRl.allowed) return rateLimitResponse(aggRl.remaining, aggRl.resetAt);

  // Rate limit: 5 batch requests per 5 minutes per user
  const rl = await distributedRateLimit(`gen-voice-batch:${mid.userId!}`, 5, 300);
  if (!rl.allowed) return rateLimitResponse(rl.remaining, rl.resetAt);

  const { items, voiceSettings } = mid.body as z.infer<typeof voiceBatchSchema>;

  // Content safety — batch text gets sent to TTS service
  const batchText = items.map(i => i.text).join(' ');
  const safety = sanitizePrompt(batchText);
  if (!safety.safe) {
    return NextResponse.json(
      { error: safety.reason ?? 'Content rejected by safety filter' },
      { status: 422 }
    );
  }

  // Token cost: discounted per-item rate (cheaper than single voice generation)
  const tokenCost = items.length * TOKEN_COSTS.voice_batch_cost_per_item;

  let apiKey: string;
  let usageId: string | undefined;
  try {
    const resolved = await resolveApiKey(
      mid.userId!,
      'elevenlabs',
      tokenCost,
      'voice_batch_generation',
      { itemCount: items.length, speaker: items[0]?.speaker }
    );
    apiKey = resolved.key;
    usageId = resolved.usageId;
  } catch (err) {
    if (err instanceof ApiKeyError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 402 });
    }
    throw err;
  }

  const client = new ElevenLabsClient({ apiKey });

  // Generate voices sequentially (ElevenLabs rate limits concurrent requests)
  const results: { nodeId: string; audioBase64: string; durationSeconds: number }[] = [];
  const errors: { nodeId: string; error: string }[] = [];

  for (const item of items) {
    try {
      const result = await client.generateVoice({
        text: item.text,
        voiceId: voiceSettings.voiceId,
        stability: voiceSettings.stability,
        similarityBoost: voiceSettings.similarityBoost,
        style: voiceSettings.style,
      });

      results.push({
        nodeId: item.nodeId,
        audioBase64: result.audioBase64,
        durationSeconds: result.durationSeconds,
      });
    } catch (err) {
      captureException(err, { route: '/api/generate/voice/batch', nodeId: item.nodeId });
      errors.push({
        nodeId: item.nodeId,
        error: err instanceof Error ? err.message : 'Generation failed',
      });
    }
  }

  // Refund tokens for failed items.
  // We charged items.length * 5 upfront; give back 5 tokens per item that failed.
  if (errors.length > 0 && usageId) {
    try {
      if (results.length === 0) {
        // All items failed — full refund via the original usage record
        await refundTokens(mid.userId!, usageId);
      } else {
        // Partial failure — refund 5 tokens per failed item.
        // Pass usageId so refundTokenAmount restores to the correct pool
        // (monthly vs addon) instead of always crediting addon tokens.
        const refundAmount = errors.length * 5;
        await refundTokenAmount(
          mid.userId!,
          refundAmount,
          `voice_batch_partial_failure:${errors.length}_of_${items.length}_failed`,
          usageId,
        );
      }
    } catch (refundErr) {
      captureException(refundErr, { route: '/api/generate/voice/batch', action: 'refund', usageId });
    }
  }

  return NextResponse.json({
    results,
    errors,
    totalGenerated: results.length,
    totalFailed: errors.length,
  });
}
