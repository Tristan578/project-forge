import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withApiMiddleware } from '@/lib/api/middleware';
import { updateDisplayName } from '@/lib/auth/user-service';
import { captureException } from '@/lib/monitoring/sentry-server';
import { internalError } from '@/lib/api/errors';
import { withEgressGuard } from '@/lib/security/egressGuard';

const profileUpdateSchema = z.object({
  displayName: z.string().trim().min(2).max(100),
});

/**
 * GET /api/user/profile
 * Get the authenticated user's profile data.
 */
async function GET_impl(req: NextRequest) {
  const mid = await withApiMiddleware(req, {
    requireAuth: true,
    rateLimit: true,
    rateLimitConfig: { key: (id) => `user:profile-get:${id}`, max: 30, windowSeconds: 60 },
  });
  if (mid.error) return mid.error;

  const user = mid.authContext!.user;

  return NextResponse.json({
    displayName: user.displayName,
    email: user.email,
    tier: user.tier,
    createdAt: user.createdAt.toISOString(),
    // Stripe Entitlements active feature lookup_keys (PF-911 / #8821). null
    // until an entitlement summary has been synced; the client then falls back
    // to tier-derived capability defaults.
    activeFeatures: user.activeFeatures ?? null,
  });
}

/**
 * PUT /api/user/profile
 * Update the authenticated user's display name.
 */
async function PUT_impl(request: NextRequest) {
  const mid = await withApiMiddleware(request, {
    requireAuth: true,
    rateLimit: true,
    rateLimitConfig: { key: (id) => `user:profile-put:${id}`, max: 10, windowSeconds: 60 },
    validate: profileUpdateSchema,
  });
  if (mid.error) return mid.error;

  const { displayName } = mid.body as z.infer<typeof profileUpdateSchema>;

  try {
    const user = await updateDisplayName(mid.userId!, displayName);
    return NextResponse.json({
      displayName: user.displayName,
      email: user.email,
      tier: user.tier,
      createdAt: user.createdAt.toISOString(),
    });
  } catch (err) {
    captureException(err, { route: '/api/user/profile', method: 'PUT' });
    return internalError('Failed to update profile');
  }
}

// Egress guard (#9736): every response this route returns leaves through the
// one redaction chokepoint. See `src/lib/security/egressGuard.ts`.
export const GET = withEgressGuard(GET_impl);
export const PUT = withEgressGuard(PUT_impl);
