import { NextRequest, NextResponse, after } from 'next/server';
import { rateLimitPublicRoute } from '@/lib/rateLimit';

/**
 * POST /api/vitals
 *
 * Receives Core Web Vitals metrics from the client.
 * Validates the payload and logs structured data for monitoring.
 *
 * Rate limited to 10 requests per minute per IP.
 */

const VALID_METRIC_NAMES = ['LCP', 'FCP', 'CLS', 'INP', 'TTFB'] as const;

interface VitalsPayload {
  name: string;
  value: number;
  id: string;
  delta: number;
}

function isValidPayload(body: unknown): body is VitalsPayload {
  if (typeof body !== 'object' || body === null) return false;
  const obj = body as Record<string, unknown>;
  return (
    typeof obj.name === 'string' &&
    typeof obj.value === 'number' &&
    Number.isFinite(obj.value) &&
    typeof obj.id === 'string' &&
    typeof obj.delta === 'number' &&
    Number.isFinite(obj.delta)
  );
}

export async function POST(request: NextRequest) {
  const rateLimited = await rateLimitPublicRoute(request, 'vitals', 10, 60_000);
  if (rateLimited) return rateLimited;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!isValidPayload(body)) {
    return NextResponse.json(
      { error: 'Missing or invalid required fields: name (string), value (finite number), id (string), delta (finite number)' },
      { status: 400 }
    );
  }

  if (!VALID_METRIC_NAMES.includes(body.name as typeof VALID_METRIC_NAMES[number])) {
    return NextResponse.json(
      { error: `Invalid metric name. Must be one of: ${VALID_METRIC_NAMES.join(', ')}` },
      { status: 400 }
    );
  }

  // Schedule structured logging after the 204 response is sent — fire-and-forget,
  // non-critical, so it should not delay the response to the client.
  after(() => {
    if (process.env.NODE_ENV === 'production') {
      console.log(
        JSON.stringify({
          type: 'web-vital',
          metric: body.name,
          value: body.value,
          delta: body.delta,
          id: body.id,
          timestamp: Date.now(),
        })
      );
    } else {
      console.log(`[Vitals] ${body.name}: ${body.value} (delta: ${body.delta})`);
    }
  });

  return new NextResponse(null, { status: 204 });
}
