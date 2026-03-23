import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { updateDisplayName } from '@/lib/auth/user-service';
import { parseJsonBody, requireString } from '@/lib/apiValidation';
import { rateLimit, rateLimitResponse } from '@/lib/rateLimit';

/**
 * GET /api/user/profile
 * Get the authenticated user's profile data.
 */
export async function GET() {
  const authResult = await authenticateRequest();
  if (!authResult.ok) return authResult.response;

  const rl = await rateLimit(`user:profile-get:${authResult.ctx.user.id}`, 30, 60_000);
  if (!rl.allowed) return rateLimitResponse(rl.remaining, rl.resetAt);

  const user = authResult.ctx.user;

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
  const authResult = await authenticateRequest();
  if (!authResult.ok) return authResult.response;

  const rl = await rateLimit(`user:profile-put:${authResult.ctx.user.id}`, 10, 60_000);
  if (!rl.allowed) return rateLimitResponse(rl.remaining, rl.resetAt);

  const parsed = await parseJsonBody(request);
  if (!parsed.ok) return parsed.response;

  const nameResult = requireString(parsed.body.displayName, 'displayName', { minLength: 2, maxLength: 100 });
  if (!nameResult.ok) return nameResult.response;

  try {
    const user = await updateDisplayName(authResult.ctx.user.id, nameResult.value);
    return NextResponse.json({
      displayName: user.displayName,
      email: user.email,
      tier: user.tier,
      createdAt: user.createdAt.toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 400 }
    );
  }
}
