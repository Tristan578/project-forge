/**
 * Security policy — single source of truth for which server routes require a
 * step-up re-verification, and which account-protection factors the app expects
 * Clerk to enforce (PF-910, #8820).
 *
 * Why this exists as code, not prose
 * ----------------------------------
 * Some Clerk protections are Dashboard-only toggles (Smart CAPTCHA bot
 * protection, the global passkey/TOTP factor availability). Those cannot be
 * asserted from this repo at request time. But the *step-up* requirement on a
 * sensitive action IS code we own and MUST enforce: a request to delete an
 * account, manage BYOK keys, change billing, or publish a game should be gated
 * behind a recent re-authentication so a hijacked-but-stale session token can't
 * perform a destructive/financial action.
 *
 * `STEP_UP_ROUTES` is the authoritative list consumed by `requireStepUp()` in
 * `./step-up.ts`. `EXPECTED_CLERK_PROTECTIONS` documents the Dashboard-side
 * expectations so the runbook (docs/security/clerk-account-protection.md) and
 * the code stay in lockstep; a test pins both so neither drifts silently.
 *
 * IMPORTANT: every enforcement here is no-op when Clerk keys are absent (see
 * `step-up.ts`) — CI/dev/E2E run without Clerk and must be unaffected.
 */

/**
 * Clerk reverification configuration for a step-up check.
 *
 * Mirrors Clerk's `ReverificationConfig` shape (a named preset, or a
 * `{ level, afterMinutes }` object) without importing Clerk types here so this
 * module stays importable from non-Clerk contexts (tests, the runbook
 * generator). `requireStepUp()` passes the value straight to `auth().has()`.
 *
 * - `level: 'second_factor'` requires the user to have completed a 2FA factor
 *   (TOTP/passkey/backup-code) within `afterMinutes`.
 * - `level: 'first_factor'` requires a recent password/passkey/email re-auth.
 */
export type StepUpLevel = 'first_factor' | 'second_factor' | 'multi_factor';

export interface StepUpConfig {
  /** Credential level the recent verification must satisfy. */
  level: StepUpLevel;
  /** Max age (minutes) of that verification before re-auth is demanded. */
  afterMinutes: number;
}

/**
 * The sensitive server routes that require a step-up re-verification, keyed by
 * a stable policy id. Each entry pairs the route path (for the runbook + the
 * route-coverage test) with the reverification config the guard enforces.
 *
 * Tuned conservatively: a 10-minute window means a user who just authenticated
 * is not re-challenged, but a long-lived session must re-verify before a
 * destructive/financial action.
 */
export const STEP_UP_ROUTES = {
  /** Permanent account + all-data deletion. Highest stakes — demand 2FA. */
  'user-delete': {
    path: '/api/user/delete',
    config: { level: 'second_factor', afterMinutes: 10 },
  },
  /** Writing/removing a BYOK provider API key (exfiltration risk). */
  'keys-write': {
    path: '/api/keys/[provider]',
    config: { level: 'second_factor', afterMinutes: 10 },
  },
  /** Starting a paid Stripe Checkout subscription. */
  'billing-checkout': {
    path: '/api/billing/checkout',
    config: { level: 'first_factor', afterMinutes: 10 },
  },
  /** Opening the Stripe billing portal (cancel/refund/payment-method change). */
  'billing-portal': {
    path: '/api/billing/portal',
    config: { level: 'first_factor', afterMinutes: 10 },
  },
} as const satisfies Record<string, { path: string; config: StepUpConfig }>;

export type StepUpRouteId = keyof typeof STEP_UP_ROUTES;

/**
 * Clerk account-protection factors the app expects to be enabled in the Clerk
 * Dashboard. These are NOT enforceable from this repo (Dashboard-only), so they
 * live here as documented expectations that the runbook mirrors. The test for
 * this module asserts the runbook lists each one, keeping doc and policy synced.
 */
export const EXPECTED_CLERK_PROTECTIONS = [
  {
    id: 'mfa-totp',
    label: 'Multi-factor authentication (TOTP / authenticator app)',
    dashboardPath: 'User & Authentication → Multi-factor → Authenticator application',
  },
  {
    id: 'passkeys',
    label: 'Passkeys (WebAuthn)',
    dashboardPath: 'User & Authentication → Web3 & Passkeys → Passkeys',
  },
  {
    id: 'bot-protection',
    label: 'Bot sign-up protection (Smart CAPTCHA)',
    dashboardPath: 'User & Authentication → Attack protection → Bot sign-up protection',
  },
] as const;

export type ClerkProtectionId = (typeof EXPECTED_CLERK_PROTECTIONS)[number]['id'];
