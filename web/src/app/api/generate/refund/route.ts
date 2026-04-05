/**
 * POST /api/generate/refund — refund tokens for a failed generation job.
 *
 * Idempotent: checks metadata->>'refundedUsageId' before crediting to prevent
 * double-refund when both server and client race to trigger a refund.
 * Requires the `usageId` returned by the original generate endpoint.
 */

export const maxDuration = 10; // API_MAX_DURATION_SIMPLE_S

import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/lib/api/middleware';
import { refundTokens } from '@/lib/tokens/service';
import { captureException } from '@/lib/monitoring/sentry-server';

export async function POST(request: NextRequest) {
  const mid = await withApiMiddleware(request, {
    requireAuth: true,
    rateLimit: true,
    rateLimitConfig: { key: (id) => `refund:${id}`, max: 3, windowSeconds: 60 },
  });
  if (mid.error) return mid.error;

  // 2. Parse request
  let body: {
    usageId: string;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { usageId } = body;

  if (!usageId) {
    return NextResponse.json({ error: 'usageId required' }, { status: 400 });
  }

  // 3. Refund tokens
  try {
    await refundTokens(mid.userId!, usageId);

    return NextResponse.json({
      success: true,
    });
  } catch (err) {
    captureException(err, { route: '/api/generate/refund', usageId });
    return NextResponse.json({ error: 'Refund failed' }, { status: 500 });
  }
}
