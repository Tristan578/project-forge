/**
 * Step-up (re-verification) guard for sensitive server routes (PF-910, #8820).
 *
 * A long-lived Clerk session token is enough to call any authenticated route.
 * For destructive or financial actions (account deletion, BYOK key writes,
 * billing changes, publish) that is too weak: a token lifted from a stale tab
 * or an unattended machine could perform them. This guard demands that the
 * caller re-verified a credential recently — Clerk's "step-up" / reverification
 * mechanism — before the action is allowed.
 *
 * Enforcement uses Clerk's server-side `auth().has({ reverification })`, which
 * inspects the session's factor-verification age against the requested level
 * and window. The route policy (level + window per route) lives in
 * `./security-policy.ts`.
 *
 * No-op without Clerk (CRITICAL): mirrors the `hasValidClerkKey` guard in
 * `web/src/app/layout.tsx` and the `isClerkConfigured()` check in
 * `./api-auth.ts`. When Clerk keys are absent (CI, E2E, local dev without
 * Clerk), `auth()` would throw, so this guard returns `{ ok: true }` and the
 * action proceeds — exactly as the rest of the auth stack degrades. Tests and
 * CI are therefore unaffected.
 *
 * Always use this AFTER `withApiMiddleware({ requireAuth: true })` has
 * established a session; a step-up check on an unauthenticated request would be
 * meaningless. This guard intentionally does NOT re-run primary auth.
 */

import { NextResponse } from 'next/server';
import type { StepUpConfig } from './security-policy';

/**
 * Returns true when valid Clerk keys are present. Duplicated from `api-auth.ts`
 * (not imported) to keep this guard free of that module's DB/user-sync imports
 * and to keep the no-op contract local and obvious.
 */
function isClerkConfigured(): boolean {
  const secretKey = process.env.CLERK_SECRET_KEY;
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  return !!secretKey?.startsWith('sk_') && !!publishableKey?.startsWith('pk_');
}

/** Result of a step-up check: allow, or a ready-to-return 403 response. */
export type StepUpResult =
  | { ok: true; response?: undefined }
  | { ok: false; response: NextResponse };

/**
 * Body returned on a failed step-up. The `reverification` hint tells the client
 * SDK (via `useReverification` / Clerk's `__clerk_status` convention) which
 * level + window to satisfy, so it can launch the re-auth flow and retry. The
 * top-level `error`/`code` match the app's standard error envelope.
 */
function reverificationRequired(config: StepUpConfig): NextResponse {
  return NextResponse.json(
    {
      error: 'Re-verification required',
      code: 'REVERIFICATION_REQUIRED',
      // Clerk's client SDK recognises this shape to trigger the step-up modal.
      clerk_error: {
        type: 'forbidden',
        reason: 'reverification-error',
      },
      reverification: {
        level: config.level,
        afterMinutes: config.afterMinutes,
      },
    },
    { status: 403 },
  );
}

/**
 * Require that the current session satisfies a step-up re-verification.
 *
 * @param config Reverification level + max-age window (from `security-policy`).
 * @returns `{ ok: true }` to proceed, or `{ ok: false, response }` (403) to
 *          return immediately from the route handler.
 *
 * @example
 * ```ts
 * const stepUp = await requireStepUp(STEP_UP_ROUTES['user-delete'].config);
 * if (!stepUp.ok) return stepUp.response;
 * // ...destructive action
 * ```
 */
export async function requireStepUp(config: StepUpConfig): Promise<StepUpResult> {
  // No-op when Clerk is not configured — auth() would throw, and CI/E2E/dev
  // must be unaffected. Fail OPEN here intentionally: this is a second factor
  // layered on top of primary auth (which already gated the request), and the
  // no-Clerk environments are non-production by construction.
  if (!isClerkConfigured()) {
    return { ok: true };
  }

  type HasFn = (params: { reverification: StepUpConfig }) => boolean;
  let has: HasFn | null = null;
  let userId: string | null = null;
  try {
    const { auth } = await import('@clerk/nextjs/server');
    const session = await auth();
    userId = session.userId;
    // Clerk's `has` accepts a `reverification` config of the `{ level,
    // afterMinutes }` shape, which `StepUpConfig` is structurally. Narrow via
    // `unknown` since Clerk's broader `CheckAuthorizationFromSessionClaims`
    // signature doesn't directly overlap our restricted call shape.
    has = session.has as unknown as HasFn;
  } catch {
    // Clerk transient error / malformed token. Primary auth already ran in the
    // middleware; if the session is genuinely broken the request would not have
    // reached here. Demand re-verification rather than silently allowing.
    return { ok: false, response: reverificationRequired(config) };
  }

  // No session despite Clerk being configured — treat as needing re-auth. The
  // route's own requireAuth should have caught this, but fail closed here.
  if (!userId || !has) {
    return { ok: false, response: reverificationRequired(config) };
  }

  const satisfied = has({ reverification: config });
  if (!satisfied) {
    return { ok: false, response: reverificationRequired(config) };
  }

  return { ok: true };
}
