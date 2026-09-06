import { NextRequest, NextResponse } from 'next/server';

import { rateLimitResponse } from '@/lib/rateLimit';
import { distributedRateLimit } from '@/lib/rateLimit/distributed';
import { redactedJson } from '@/lib/api/errors';

export const dynamic = 'force-dynamic';

const KEY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

export async function GET(request: NextRequest): Promise<NextResponse> {
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
