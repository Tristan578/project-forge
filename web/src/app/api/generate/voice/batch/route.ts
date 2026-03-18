export const maxDuration = 120; // seconds — batch voice generation processes up to 20 items sequentially

import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { resolveApiKey, ApiKeyError } from '@/lib/keys/resolver';
import { ElevenLabsClient } from '@/lib/generate/elevenlabsClient';
import { rateLimit, rateLimitResponse } from '@/lib/rateLimit';

interface BatchItem {
  nodeId: string;
  text: string;
  speaker: string;
}

interface VoiceSettings {
  voiceId: string;
  stability: number;
  similarityBoost: number;
  style: number;
}

export async function POST(request: NextRequest) {
  const authResult = await authenticateRequest();
  if (!authResult.ok) return authResult.response;

  // Rate limit: 5 batch requests per 5 minutes per user
  const rl = rateLimit(`gen-voice-batch:${authResult.ctx.user.id}`, 5, 300_000);
  if (!rl.allowed) return rateLimitResponse(rl.remaining, rl.resetAt);

  let body: {
    items: BatchItem[];
    voiceSettings: VoiceSettings;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { items, voiceSettings } = body;

  // Validate
  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: 'items array is required' }, { status: 422 });
  }

  if (items.length > 20) {
    return NextResponse.json({ error: 'Maximum 20 items per batch' }, { status: 422 });
  }

  for (const item of items) {
    if (!item.text || item.text.length < 1 || item.text.length > 1000) {
      return NextResponse.json(
        { error: `Item "${item.nodeId}": text must be 1-1000 characters` },
        { status: 422 }
      );
    }
  }

  if (!voiceSettings?.voiceId) {
    return NextResponse.json({ error: 'voiceSettings.voiceId is required' }, { status: 422 });
  }

  // Token cost: 5 per item (discounted from 10 for single)
  const tokenCost = items.length * 5;

  let apiKey: string;
  try {
    const resolved = await resolveApiKey(
      authResult.ctx.user.id,
      'elevenlabs',
      tokenCost,
      'voice_batch_generation',
      { itemCount: items.length, speaker: items[0]?.speaker }
    );
    apiKey = resolved.key;
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
      errors.push({
        nodeId: item.nodeId,
        error: err instanceof Error ? err.message : 'Generation failed',
      });
    }
  }

  return NextResponse.json({
    results,
    errors,
    totalGenerated: results.length,
    totalFailed: errors.length,
  });
}
