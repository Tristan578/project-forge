import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, assertAdmin } from '@/lib/auth/api-auth';
import { rateLimitAdminRoute } from '@/lib/rateLimit';
import {
  getAllBreakerStats,
  resetProviderBreaker,
  resetAllBreakers,
  type ProviderName,
} from '@/lib/providers/circuitBreaker';

/**
 * GET /api/admin/circuit-breaker
 *
 * Returns the current state of all AI provider circuit breakers.
 * Admin-only endpoint.
 */
export async function GET() {
  const authResult = await authenticateRequest();
  if (!authResult.ok) return authResult.response;
  const { clerkId } = authResult.ctx;

  const adminError = assertAdmin(clerkId);
  if (adminError) return adminError;

  const rateLimitError = rateLimitAdminRoute(clerkId, 'admin-circuit-breaker');
  if (rateLimitError) return rateLimitError;

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
}

/**
 * POST /api/admin/circuit-breaker
 *
 * Reset circuit breakers (admin override).
 *
 * Body: { action: 'reset_all' } | { action: 'reset_provider', provider: string }
 */
export async function POST(request: NextRequest) {
  const authResult = await authenticateRequest();
  if (!authResult.ok) return authResult.response;
  const { clerkId } = authResult.ctx;

  const adminError = assertAdmin(clerkId);
  if (adminError) return adminError;

  const rateLimitError = rateLimitAdminRoute(clerkId, 'admin-circuit-breaker-reset');
  if (rateLimitError) return rateLimitError;

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

    const validProviders: ProviderName[] = [
      'anthropic', 'openai', 'meshy', 'elevenlabs', 'suno',
      'replicate', 'removebg', 'openrouter', 'vercel-gateway', 'github-models',
    ];

    if (!validProviders.includes(provider as ProviderName)) {
      return NextResponse.json(
        { error: `Unknown provider: ${provider}. Valid providers: ${validProviders.join(', ')}` },
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
}
