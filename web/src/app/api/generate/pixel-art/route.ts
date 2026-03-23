export const maxDuration = 60; // seconds — pixel art generation

import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { rateLimitResponse } from '@/lib/rateLimit';
import { distributedRateLimit } from '@/lib/rateLimit/distributed';
import { captureException } from '@/lib/monitoring/sentry-server';

export async function POST(request: NextRequest) {
  try {
    // 1. Authenticate
    const authResult = await authenticateRequest();
    if (!authResult.ok) return authResult.response;

    // 1b. Rate limit: 10 generation requests per 5 minutes per user
    const rl = await distributedRateLimit(`gen-pixel-art:${authResult.ctx.user.id}`, 10, 300);
    if (!rl.allowed) return rateLimitResponse(rl.remaining, rl.resetAt);

    // Pixel art generation is not yet implemented — no provider is wired.
    // Returning 501 here (before token deduction) ensures users are never
    // charged for a generation that never happens.
    void request; // will be used when provider integration is added
    return NextResponse.json(
      { error: 'Pixel art generation is not yet available. Check back soon.' },
      { status: 501 }
    );
  } catch (err) {
    captureException(err, { route: '/api/generate/pixel-art' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
