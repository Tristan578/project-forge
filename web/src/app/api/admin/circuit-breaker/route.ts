import { NextRequest, NextResponse } from 'next/server';
import { assertAdmin } from '@/lib/auth/api-auth';
import { withApiMiddleware } from '@/lib/api/middleware';
import { rateLimitAdminRoute } from '@/lib/rateLimit';
import {
  getAllBreakerStats,
  resetProviderBreaker,
  resetAllBreakers,
} from '@/lib/providers/circuitBreaker';
import { PROVIDER_NAMES, type ProviderName } from '@/lib/config/providers';
import { captureException } from '@/lib/monitoring/sentry-server';

/**
 * GET /api/admin/circuit-breaker
 *
 * Returns the current state of all AI provider circuit breakers.
 * Admin-only endpoint.
 */
export async function GET(req: NextRequest) {
  const mid = await withApiMiddleware(req, { requireAuth: true });
  if (mid.error) return mid.error;
  const { clerkId } = mid.authContext!;

  const adminError = assertAdmin(clerkId);
  if (adminError) return adminError;

  const rateLimitError = await rateLimitAdminRoute(clerkId, 'admin-circuit-breaker');
  if (rateLimitError) return rateLimitError;

  try {
    const stats = getAllBreakerStats();

    const openCount = stats.filter((s) => s.state === 'OPEN').length;
    const halfOpenCount = stats.filter((s) => s.state === 'HALF_OPEN').length;
    const healthyCount = stats.filter((s) => s.state === 'CLOSED').length;

    return NextResponse.json({
      summary: {
        total: stats.length,
        healthy: healthyCount,
        open: openCount,
        halfOpen: halfOpenCount,
      },
      providers: stats,
    });
  } catch (error) {
    captureException(error, { route: '/api/admin/circuit-breaker', method: 'GET' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/admin/circuit-breaker
 *
 * Reset circuit breakers (admin override).
 *
 * Body: { action: 'reset_all' } | { action: 'reset_provider', provider: string }
 */
export async function POST(request: NextRequest) {
  const mid = await withApiMiddleware(request, { requireAuth: true });
  if (mid.error) return mid.error;
  const { clerkId } = mid.authContext!;

  const adminError = assertAdmin(clerkId);
  if (adminError) return adminError;

  const rateLimitError = await rateLimitAdminRoute(clerkId, 'admin-circuit-breaker-reset');
  if (rateLimitError) return rateLimitError;

  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    if (typeof body !== 'object' || body === null) {
      return NextResponse.json({ error: 'Body must be a JSON object' }, { status: 400 });
    }

    const { action, provider } = body as Record<string, unknown>;

    if (action === 'reset_all') {
      resetAllBreakers();
      return NextResponse.json({
        success: true,
        message: 'All circuit breakers reset to CLOSED',
      });
    }

    if (action === 'reset_provider') {
      if (typeof provider !== 'string' || !provider) {
        return NextResponse.json(
          { error: 'Missing provider field for reset_provider action' },
          { status: 400 }
        );
      }

      if (!(PROVIDER_NAMES as readonly string[]).includes(provider)) {
        return NextResponse.json(
          { error: `Unknown provider: ${provider}. Valid providers: ${PROVIDER_NAMES.join(', ')}` },
          { status: 400 }
        );
      }

      resetProviderBreaker(provider as ProviderName);
      return NextResponse.json({
        success: true,
        message: `Circuit breaker for ${provider} reset to CLOSED`,
      });
    }

    return NextResponse.json(
      { error: 'Unknown action. Valid actions: reset_all, reset_provider' },
      { status: 400 }
    );
  } catch (error) {
    captureException(error, { route: '/api/admin/circuit-breaker', method: 'POST' });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
