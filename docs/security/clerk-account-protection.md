# Clerk Account Protection & Step-Up Re-Verification

PF-910 (#8820). This page is the operator runbook for the account-protection
factors that are **Clerk Dashboard toggles** (cannot be code), paired with the
**in-repo step-up enforcement** that gates sensitive routes.

The code enforcement is the deliverable; this runbook is the supplement for the
Dashboard-only toggles. The expectations below are mirrored in
`web/src/lib/auth/security-policy.ts` (`EXPECTED_CLERK_PROTECTIONS`), and a unit
test (`web/src/lib/auth/__tests__/security-policy-runbook.test.ts`) asserts this
doc lists each one, so the two can't drift.

## 1. In-repo enforcement (already shipped)

`web/src/lib/auth/step-up.ts` exports `requireStepUp(config)`, which calls
Clerk's server-side `auth().has({ reverification })` to require a **recent
re-verification** before a sensitive action runs. The per-route policy lives in
`web/src/lib/auth/security-policy.ts` (`STEP_UP_ROUTES`).

Wired into these sensitive routes:

| Route | Method | Level | Window |
|-------|--------|-------|--------|
| `/api/user/delete` | POST | `second_factor` | 10 min |
| `/api/keys/[provider]` | PUT / DELETE | `second_factor` | 10 min |
| `/api/billing/checkout` | POST | `first_factor` | 10 min |
| `/api/billing/portal` | POST | `first_factor` | 10 min |

On a stale/absent re-verification the route returns **403** with
`code: "REVERIFICATION_REQUIRED"` and a `reverification` hint
(`{ level, afterMinutes }`) plus the `clerk_error` envelope Clerk's client SDK
uses to launch the step-up modal. Wire the client retry with Clerk's
`useReverification()` hook.

**No Clerk env = no-op.** When `CLERK_SECRET_KEY` / `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
are absent or non-real (CI, E2E, local dev), `requireStepUp` allows the action —
mirroring the rest of the auth stack (`hasValidClerkKey` in `layout.tsx`,
`isClerkConfigured()` in `api-auth.ts`). No production behaviour is bypassed
because those environments are non-production by construction.

## 2. Dashboard toggles (operator action — cannot be code)

These enable the FACTORS the step-up guard checks for, and the bot protection
that has no server-route surface. Enable each in the Clerk Dashboard for the
**production** instance:

| ID | Protection | Dashboard path |
|----|-----------|----------------|
| `mfa-totp` | MFA (TOTP / authenticator app) | User & Authentication → Multi-factor → Authenticator application |
| `passkeys` | Passkeys (WebAuthn) | User & Authentication → Web3 & Passkeys → Passkeys |
| `bot-protection` | Bot sign-up protection (Smart CAPTCHA) | User & Authentication → Attack protection → Bot sign-up protection |

Notes:

- **MFA / passkeys** must be enabled for `second_factor`-level step-up checks to
  be satisfiable — otherwise users have no second factor to re-verify with and
  the destructive routes are unreachable. Enable at least one second factor
  before relying on `second_factor` policy.
- **Bot protection** (Smart CAPTCHA) is enforced by Clerk's `<SignIn>` /
  `<SignUp>` widgets at sign-up time; there is no server route to gate, so it is
  Dashboard-only by nature.
- `@clerk/nextjs` 7.5.x already supports all three — no dependency change is
  needed; these are runtime configuration, not code.

## 3. Verifying

- Unit: `npx vitest run src/lib/auth/__tests__/step-up.test.ts src/lib/auth/__tests__/security-policy-runbook.test.ts`
- Manual: with a production-like session that has not re-verified in >10 min,
  POST `/api/user/delete` and confirm a 403 with `REVERIFICATION_REQUIRED`.
