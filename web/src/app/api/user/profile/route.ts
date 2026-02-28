import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { updateDisplayName } from '@/lib/auth/user-service';

/**
 * GET /api/user/profile
 * Get the authenticated user's profile data.
 */
export async function GET() {
  const authResult = await authenticateRequest();
  if (!authResult.ok) return authResult.response;

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

  let body: { displayName?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (typeof body.displayName !== 'string') {
    return NextResponse.json({ error: 'displayName is required' }, { status: 400 });
  }

  try {
    const user = await updateDisplayName(authResult.ctx.user.id, body.displayName);
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
