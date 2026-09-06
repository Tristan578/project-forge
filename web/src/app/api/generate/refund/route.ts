/**
 * POST /api/generate/refund — refund tokens for a failed generation job.
 *
 * Idempotent: checks metadata->>'refundedUsageId' before crediting to prevent
 * double-refund when both server and client race to trigger a refund.
 * Requires the `usageId` returned by the original generate endpoint.
 */

export const maxDuration = 10; // API_MAX_DURATION_SIMPLE_S

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withApiMiddleware } from '@/lib/api/middleware';
import { refundTokens } from '@/lib/tokens/service';
import { captureException } from '@/lib/monitoring/sentry-server';
import { redactedJson } from '@/lib/api/errors';
import { withEgressGuard } from '@/lib/security/egressGuard';

const refundSchema = z.object({
  usageId: z.string().min(1).max(100),
});

async function POST_impl(request: NextRequest) {
  const mid = await withApiMiddleware(request, {
    requireAuth: true,
    rateLimit: true,
    rateLimitConfig: { key: (id) => `refund:${id}`, max: 3, windowSeconds: 60 },
    validate: refundSchema,
  });
  if (mid.error) return mid.error;

  const { usageId } = mid.body as z.infer<typeof refundSchema>;

  // 3. Refund tokens
  try {
    await refundTokens(mid.userId!, usageId);

    return NextResponse.json({
      success: true,
    });
  } catch (err) {
    captureException(err, { route: '/api/generate/refund', usageId });
    return redactedJson({ error: 'Refund failed' }, { status: 500 });
  }
}

// Egress guard (#9736): every response this route returns leaves through the
// one redaction chokepoint. See `src/lib/security/egressGuard.ts`.
export const POST = withEgressGuard(POST_impl);
