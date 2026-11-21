/**
 * POST /api/game/pipeline — Token budget operations for the game creation pipeline.
 *
 * Supports three actions via the `action` field:
 * - reserve: Reserve tokens upfront before pipeline execution
 * - record_step: Record per-step usage (audit only, no deduction)
 * - release: Release unused tokens after pipeline completes
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withApiMiddleware } from '@/lib/api/middleware';
import { reserveTokenBudget, releaseUnusedBudget, recordStepUsage } from '@/lib/tokens/budget';

const MAX_PIPELINE_TOKENS = 1_000_000;

const reserveSchema = z.object({
  action: z.literal('reserve'),
  estimatedTotal: z.number().int().min(0).max(MAX_PIPELINE_TOKENS),
});

const recordStepSchema = z.object({
  action: z.literal('record_step'),
  reservationId: z.string().uuid(),
  stepId: z.string().min(1),
  tokensUsed: z.number().int().min(0).max(MAX_PIPELINE_TOKENS),
});

const releaseSchema = z.object({
  action: z.literal('release'),
  reservationId: z.string().uuid(),
  actualUsed: z.number().int().min(0).max(MAX_PIPELINE_TOKENS),
});

const requestSchema = z.discriminatedUnion('action', [
  reserveSchema,
  recordStepSchema,
  releaseSchema,
]);

export async function POST(req: NextRequest) {
  const mid = await withApiMiddleware(req, {
    requireAuth: true,
    rateLimit: true,
    rateLimitConfig: { key: (id) => `game-pipeline:${id}`, max: 30, windowSeconds: 60 },
  });
  if (mid.error) return mid.error;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: 'validation_error', details: ['Invalid JSON body'] },
      { status: 400 },
    );
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'validation_error',
        details: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`),
      },
      { status: 400 },
    );
  }

  const data = parsed.data;

  if (data.action === 'reserve') {
    const result = await reserveTokenBudget(mid.userId!, data.estimatedTotal);
    if (!result.success) {
      return NextResponse.json(
        { error: 'insufficient_tokens', balance: result.balance, cost: result.cost },
        { status: 402 },
      );
    }
    return NextResponse.json({
      reservationId: result.reservationId,
      remaining: result.remaining,
    });
  }

  if (data.action === 'record_step') {
    await recordStepUsage(mid.userId!, data.reservationId, data.stepId, data.tokensUsed);
    return NextResponse.json({ ok: true });
  }

  // action === 'release'
  const result = await releaseUnusedBudget(mid.userId!, data.reservationId, data.actualUsed);
  return NextResponse.json({
    refunded: result.refunded,
    remaining: result.remaining,
  });
}
