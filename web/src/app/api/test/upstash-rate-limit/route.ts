import { NextRequest, NextResponse } from 'next/server';

import { rateLimitResponse } from '@/lib/rateLimit';
import { distributedRateLimit } from '@/lib/rateLimit/distributed';
import { redactedJson } from '@/lib/api/errors';
import { withEgressGuard } from '@/lib/security/egressGuard';

export const dynamic = 'force-dynamic';

const KEY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

async function GET_impl(request: NextRequest): Promise<NextResponse> {
  if (process.env.E2E_UPSTASH_TEST_ENABLED !== 'true') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const requestKey = request.headers.get('x-e2e-rate-limit-key');
  if (!requestKey || !KEY_PATTERN.test(requestKey)) {
    return NextResponse.json({ error: 'Invalid test key' }, { status: 400 });
  }

  try {
    const result = await distributedRateLimit(
      `ci-integration:${requestKey}`,
      2,
      300,
      { fallbackOnError: false }
    );

    if (!result.allowed) {
      return rateLimitResponse(result.remaining, result.resetAt);
    }

    return NextResponse.json({ ok: true, remaining: result.remaining });
  } catch {
    return redactedJson(
      { error: 'CI Upstash integration unavailable' },
      { status: 503 }
    );
  }
}

// Egress guard (#9736): every response this route returns leaves through the
// one redaction chokepoint. See `src/lib/security/egressGuard.ts`.
export const GET = withEgressGuard(GET_impl);
