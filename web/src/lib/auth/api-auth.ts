import { auth, clerkClient } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { getUserByClerkId, syncUserFromClerk } from './user-service';
import type { User } from '../db/schema';

export interface AuthContext {
  user: User;
  clerkId: string;
}

/**
 * Returns true when valid Clerk keys are present (matching the condition in proxy.ts).
 * When false, Clerk middleware is inactive (CI/E2E passthrough mode) and calling
 * auth() would throw an error, so we skip it entirely.
 */
function isClerkConfigured(): boolean {
  const secretKey = process.env.CLERK_SECRET_KEY;
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  return !!secretKey?.startsWith('sk_') && !!publishableKey?.startsWith('pk_');
}

/**
 * Authenticate an API request using Clerk session.
 * Returns the user or a 401 error response.
 */
export async function authenticateRequest(): Promise<
  { ok: true; ctx: AuthContext } | { ok: false; response: NextResponse }
> {
  if (!isClerkConfigured()) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }

  const { userId: clerkId } = await auth();

  if (!clerkId) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }

  const user = await getUserByClerkId(clerkId);
  if (!user) {
    // Auto-sync: user is authenticated with Clerk but missing from our DB.
    // This handles webhook failures, new deployments, or DB resets.
    try {
      const clerkUser = await clerkClient.users.getUser(clerkId);
      const syncedUser = await syncUserFromClerk({
        id: clerkId,
        email_addresses: clerkUser.emailAddresses.map(
          (e: { emailAddress: string }) => ({ email_address: e.emailAddress })
        ),
        first_name: clerkUser.firstName,
        last_name: clerkUser.lastName,
      });
      return { ok: true, ctx: { user: syncedUser, clerkId } };
    } catch {
      return {
        ok: false,
        response: NextResponse.json(
          { error: 'USER_NOT_FOUND', message: 'Authenticated but user record not yet synced' },
          { status: 404 },
        ),
      };
    }
  }

  return { ok: true, ctx: { user, clerkId } };
}

/**
 * Validate Clerk session only (no DB user lookup).
 * Use for routes that can degrade gracefully when the DB user
 * hasn't been synced yet (e.g. return empty list instead of 401).
 */
export async function authenticateClerkSession(): Promise<
  { ok: true; clerkId: string } | { ok: false; response: NextResponse }
> {
  if (!isClerkConfigured()) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }

  const { userId: clerkId } = await auth();

  if (!clerkId) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }

  return { ok: true, clerkId };
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
