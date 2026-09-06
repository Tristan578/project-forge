import { auth, clerkClient } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { getUserByClerkId, syncUserFromClerk } from './user-service';
import { captureException } from '@/lib/monitoring/sentry-server';
import { redactedJson } from '@/lib/api/errors';
import type { User } from '../db/schema';

export interface AuthContext {
  user: User;
  clerkId: string;
}

/** Delay helper for retry backoff */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    return unauthorized('CLERK_NOT_CONFIGURED');
  }

  let clerkId: string | null | undefined;
  try {
    ({ userId: clerkId } = await auth());
  } catch {
    // Expired token, malformed JWT, or Clerk transient error.
    // Fail closed with 401 instead of propagating a 500. The distinct
    // `reason` lets on-call distinguish an auth-provider outage from a
    // routine missing-session 401 in Sentry without leaking detail to
    // the client.
    return unauthorized('AUTH_PROVIDER_ERROR');
  }

  if (!clerkId) {
    return unauthorized('NO_SESSION');
  }

  let user: User | null;
  try {
    user = await getUserByClerkId(clerkId);
  } catch (err) {
    // REPORT before returning. This branch used to swallow the error, so a
    // production 503 said only "User sync temporarily unavailable" and gave
    // neither the client nor the logs any way to tell a DB outage from a Clerk
    // failure from a permanently unsyncable account. The reason tag is what
    // makes the two 503 paths distinguishable in Sentry.
    captureException(err, { route: 'api_auth', phase: 'get_user_by_clerk_id' });
    // DB unavailable (circuit breaker open, Neon outage, etc). Return 503
    // to match the degraded-mode contract — returning 500 would leak a
    // generic error to clients and bypass the retry guidance in the 503
    // payload. Never fall through to a userless AuthContext (credit bypass).
    return {
      ok: false,
      // `redactedJson`, not `NextResponse.json`: this construction sits INSIDE a
      // catch, where a raw constructor is banned (#9736). The body is two fixed
      // strings today; the redactor is what keeps that true if it stops being.
      response: redactedJson(
        { error: 'SERVICE_DEGRADED', message: 'User sync temporarily unavailable. Please retry.' },
        { status: 503 },
      ),
    };
  }
  if (!user) {
    // Auto-sync: user is authenticated with Clerk but missing from our DB.
    // Handles webhook failures, new deployments, or DB resets (PF-474).
    const syncResult = await attemptSyncWithRetry(clerkId);
    if (syncResult.kind === 'deleted') {
      // Clerk says the user is gone — the session token is stale. This is
      // an auth failure, not a service outage. Return 401 so client SDKs
      // refresh the token, and close the timing side-channel that would
      // otherwise distinguish a deleted user (fast 503) from a transient
      // DB failure (slow 503).
      return unauthorized('STALE_SESSION');
    }
    if (syncResult.kind === 'unsyncable') {
      // PERMANENT, not transient. The account cannot be synced no matter how
      // many times it is retried -- the common case is a Clerk user carrying no
      // email address, which happens with GitHub OAuth when the account's email
      // is private. Reporting that as "temporarily unavailable, please retry"
      // sends the user into an endless retry against a condition that will
      // never clear, so it gets its own code and a 422.
      return {
        ok: false,
        response: NextResponse.json(
          {
            error: 'ACCOUNT_NOT_SYNCABLE',
            message:
              'Your account is missing information we need (usually an email address). Add a verified email to your account and sign in again.',
          },
          { status: 422 },
        ),
      };
    }
    if (syncResult.kind === 'degraded') {
      // Genuine transient failure: deny access with 503 instead of returning a
      // user without DB state (tier, credits). Prevents credit bypass (PF-474).
      return {
        ok: false,
        response: NextResponse.json(
          { error: 'SERVICE_DEGRADED', message: 'User sync temporarily unavailable. Please retry.' },
          { status: 503 },
        ),
      };
    }
    user = syncResult.user;
  }

  // Banned check applies to BOTH the freshly-loaded and freshly-synced
  // code paths — a banned DB row must never be returned as an auth context.
  if (user.banned > 0) {
    return bannedResponse();
  }

  return { ok: true, ctx: { user, clerkId } };
}

/** Canonical 401 body with a machine-readable `reason` sub-code for observability. */
function unauthorized(reason: string): { ok: false; response: NextResponse } {
  return {
    ok: false,
    response: NextResponse.json({ error: 'Unauthorized', reason }, { status: 401 }),
  };
}

/** Canonical 403 for banned accounts. Includes a support contact so users can appeal. */
function bannedResponse(): { ok: false; response: NextResponse } {
  return {
    ok: false,
    response: NextResponse.json(
      {
        error: 'ACCOUNT_BANNED',
        message:
          'This account has been suspended. If you believe this is a mistake, contact support@spawnforge.ai to appeal.',
      },
      { status: 403 },
    ),
  };
}

type SyncResult =
  | { kind: 'ok'; user: User }
  | { kind: 'deleted' } // Clerk confirmed user no longer exists
  | { kind: 'unsyncable' } // permanent: the Clerk account lacks required data
  | { kind: 'degraded' }; // transient DB/Clerk failure after retry

/**
 * Attempt to sync a user from Clerk into our DB.
 *
 * Separates Clerk-fetch failures from DB-write failures so a "not found"
 * string in a DB error can never be misread as a deleted Clerk user. Only
 * errors thrown by `client.users.getUser(clerkId)` are checked against
 * `isClerk404`; `syncUserFromClerk` errors always go through the retry path.
 */
async function attemptSyncWithRetry(clerkId: string, _attempt = 0): Promise<SyncResult> {
  let clerkUser: Awaited<ReturnType<Awaited<ReturnType<typeof clerkClient>>['users']['getUser']>>;
  try {
    const client = await clerkClient();
    clerkUser = await client.users.getUser(clerkId);
  } catch (err) {
    // Only the Clerk fetch is checked for 404 — DB errors cannot reach here.
    if (isClerk404(err)) {
      return { kind: 'deleted' };
    }
    if (_attempt < 1) {
      await delay(500);
      return attemptSyncWithRetry(clerkId, _attempt + 1);
    }
    // A Clerk fetch that is not a 404 and survives a retry is worth seeing --
    // an invalid or missing CLERK_SECRET_KEY lands here, and previously
    // produced a bare 503 with nothing to diagnose it by.
    captureException(err, { route: 'api_auth', phase: 'clerk_get_user' });
    return { kind: 'degraded' };
  }

  try {
    const user = await syncUserFromClerk({
      id: clerkId,
      email_addresses: clerkUser.emailAddresses.map(
        (e: { emailAddress: string }) => ({ email_address: e.emailAddress }),
      ),
      first_name: clerkUser.firstName,
      last_name: clerkUser.lastName,
    });
    if (!user) return { kind: 'degraded' };
    return { kind: 'ok', user };
  } catch (err) {
    // Not every failure here is transient. syncUserFromClerk throws
    // "No email found in Clerk data" when the Clerk account carries no email
    // address -- routine for GitHub OAuth when the account's email is private.
    // Retrying that burns two attempts and a 500ms delay to reach the same
    // answer, and then tells the user to retry a condition that will never
    // clear on its own.
    if (isMissingEmail(err)) {
      captureException(err, { route: 'api_auth', phase: 'sync_user', reason: 'no_email' });
      return { kind: 'unsyncable' };
    }
    // Genuinely transient (DB write, network): retry once, then report.
    if (_attempt < 1) {
      await delay(500);
      return attemptSyncWithRetry(clerkId, _attempt + 1);
    }
    captureException(err, { route: 'api_auth', phase: 'sync_user', reason: 'db_write' });
    return { kind: 'degraded' };
  }
}

/**
 * Is this failure permanent for this account?
 *
 * `syncUserFromClerk` rejects a Clerk user with no email address, and no amount
 * of retrying supplies one. Matching on the message is unpleasant but it is the
 * only signal the thrown Error carries; the string is defined one module away
 * in user-service.ts and is covered by a test there, so a rename cannot drift
 * silently past this.
 */
function isMissingEmail(err: unknown): boolean {
  return err instanceof Error && /no email found/i.test(err.message);
}

/**
 * Detect Clerk "user not found" errors without depending on Clerk's private
 * error types. ONLY called on errors thrown by `client.users.getUser()`, so
 * it is safe to be slightly liberal on the message match — DB errors with
 * "not found" phrasing cannot reach this helper.
 */
function isClerk404(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const maybeStatus = (err as { status?: unknown }).status;
  if (maybeStatus === 404) return true;
  const maybeMessage = (err as { message?: unknown }).message;
  if (typeof maybeMessage === 'string' && /\b404\b|user not found/i.test(maybeMessage)) {
    return true;
  }
  return false;
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
    return unauthorized('CLERK_NOT_CONFIGURED');
  }

  let clerkId: string | null | undefined;
  try {
    ({ userId: clerkId } = await auth());
  } catch {
    return unauthorized('AUTH_PROVIDER_ERROR');
  }

  if (!clerkId) {
    return unauthorized('NO_SESSION');
  }

  // Lightweight banned check: this helper skips the full user sync,
  // but we must still reject banned users. If the user row is missing
  // (not yet synced), fall through in the caller's degraded-mode path.
  // DB unavailability is tolerated — callers of this function are expected
  // to degrade gracefully without a DB user record.
  try {
    const user = await getUserByClerkId(clerkId);
    if (user && user.banned > 0) {
      return bannedResponse();
    }
  } catch {
    // DB unavailable — skip the banned check and let the caller's
    // degraded-mode path handle the outage. This preserves the function's
    // contract: routes using authenticateClerkSession can operate without
    // DB access (e.g. return an empty list instead of crashing with 500).
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
