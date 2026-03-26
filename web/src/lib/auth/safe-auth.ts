/**
 * Safe auth() wrapper for Server Components (PF-324 follow-up).
 *
 * In CI/E2E environments without Clerk keys, calling auth() from
 * @clerk/nextjs/server throws "auth() was called but Clerk can't
 * detect usage of clerkMiddleware()". This wrapper returns
 * { userId: null } when Clerk is not configured, matching the
 * unauthenticated behavior.
 */

const CLERK_CONFIGURED =
  !!process.env.CLERK_SECRET_KEY?.startsWith('sk_') &&
  !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.startsWith('pk_');

/**
 * Get the current auth state safely.
 * Returns `{ userId: null }` when Clerk is not configured (CI/E2E).
 */
export async function safeAuth(): Promise<{ userId: string | null }> {
  if (!CLERK_CONFIGURED) {
    return { userId: null };
  }
  const { auth } = await import('@clerk/nextjs/server');
  return auth();
}
