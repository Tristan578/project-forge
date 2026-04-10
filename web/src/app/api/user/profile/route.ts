import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withApiMiddleware } from '@/lib/api/middleware';
import { updateDisplayName } from '@/lib/auth/user-service';
import { captureException } from '@/lib/monitoring/sentry-server';
import { internalError } from '@/lib/api/errors';

const profileUpdateSchema = z.object({
  displayName: z.string().min(2).max(100),
});

/**
 * GET /api/user/profile
 * Get the authenticated user's profile data.
 */
export async function GET(req: NextRequest) {
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
  });
}

/**
 * PUT /api/user/profile
 * Update the authenticated user's display name.
 */
export async function PUT(request: NextRequest) {
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
