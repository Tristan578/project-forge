import { NextRequest, NextResponse, after } from 'next/server';
import { z } from 'zod';
import { rateLimitPublicRoute } from '@/lib/rateLimit';

/**
 * POST /api/vitals
 *
 * Receives Core Web Vitals metrics from the client.
 * Validates the payload and logs structured data for monitoring.
 *
 * Rate limited to 10 requests per minute per IP.
 */

const vitalsSchema = z.object({
  name: z.enum(['LCP', 'FCP', 'CLS', 'INP', 'TTFB']),
  value: z.number().finite(),
  id: z.string().min(1).max(200),
  delta: z.number().finite(),
});

export async function POST(request: NextRequest) {
  const rateLimited = await rateLimitPublicRoute(request, 'vitals', 10, 60_000);
  if (rateLimited) return rateLimited;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = vitalsSchema.safeParse(raw);
  if (!parsed.success) {
    // Distinguish invalid metric name from other shape errors to preserve
    // the historical error messages the client + tests expect. Only route to
    // the "invalid metric" message when `name` is present but not in the
    // allowed enum — a missing name still counts as a shape error.
    const raw2 = raw as { name?: unknown };
    const nameBadEnum = typeof raw2?.name === 'string'
      && parsed.error.issues.some((i) => i.path[0] === 'name');
    if (nameBadEnum) {
      return NextResponse.json(
        { error: 'Invalid metric name. Must be one of: LCP, FCP, CLS, INP, TTFB' },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: 'Missing or invalid required fields: name (string), value (finite number), id (string), delta (finite number)' },
      { status: 400 }
    );
  }
  const body = parsed.data;

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
