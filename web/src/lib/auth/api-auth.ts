import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { getUserByClerkId } from './user-service';
import type { User } from '../db/schema';

export interface AuthContext {
  user: User;
  clerkId: string;
}

/**
 * Authenticate an API request using Clerk session.
 * Returns the user or a 401 error response.
 */
export async function authenticateRequest(): Promise<
  { ok: true; ctx: AuthContext } | { ok: false; response: NextResponse }
> {
  const { userId: clerkId } = await auth();

  if (!clerkId) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }

  const user = await getUserByClerkId(clerkId);
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'User not found in database' }, { status: 401 }),
    };
  }

  return { ok: true, ctx: { user, clerkId } };
}

/**
 * Check if the authenticated user is an admin.
 * Admin user IDs are set via ADMIN_USER_IDS env var (comma-separated Clerk IDs).
 * Returns a 403 response if not an admin, or null if authorized.
 */
export function assertAdmin(clerkId: string): NextResponse | null {
  const adminIds = (process.env.ADMIN_USER_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!adminIds.includes(clerkId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return null;
}

/** Check if user tier allows a specific action */
export function assertTier(
  user: User,
  requiredTiers: Array<'starter' | 'hobbyist' | 'creator' | 'pro'>
): NextResponse | null {
  if (!requiredTiers.includes(user.tier as 'starter' | 'hobbyist' | 'creator' | 'pro')) {
    return NextResponse.json(
      {
        error: 'TIER_REQUIRED',
        message: `This feature requires one of: ${requiredTiers.join(', ')}`,
        currentTier: user.tier,
      },
      { status: 403 }
    );
  }
  return null;
}
