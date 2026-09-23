# E2E Clerk test user

The `E2E Auth Journey` CI job (`test-e2e-auth` in `.github/workflows/ci.yml`, #8632) signs a real user
in against a Clerk **test** instance. This runbook covers the four secrets it reads, how the seeded user
has to be set up, and what each failure message means. It contains no credentials. Never add any here,
to a spec, or to `.env.example`.

## What runs where

| Piece | File | Role |
|---|---|---|
| CI job | `.github/workflows/ci.yml` → `test-e2e-auth` | Builds and serves the app with the test-instance keys, then runs the config below. |
| Playwright config | `web/playwright.auth.config.ts` | Runs only `@auth` tests, one worker, with the global setup and reporter below. |
| Global setup | `web/e2e/lib/clerkGlobalSetup.ts` | Refuses non-test keys, gets a Clerk testing token, and checks the seeded user exists. |
| Reporter | `web/e2e/lib/requiredRunReporter.ts` | On a required run, fails the run if any test was skipped or fewer than two passed. |
| Spec | `web/e2e/tests/auth-journey.spec.ts` | Pricing **Sign In** button → Clerk form; seeded user signs in → `/dashboard`. |

The keys are **not** on the `E2E UI Tests` shards, and must not be added there. With valid keys the proxy
switches to `clerkMiddleware`. Under `next start` (`NODE_ENV=production`), `buildPublicRoutes()` then drops
`/dev` from the public routes (`web/src/proxy.ts`). Every editor spec opens `/dev`, so every one of them
would be sent to `/sign-in`. `scripts/__tests__/e2e-tag-routing.test.sh` fails if the test-instance
secrets appear in any other job.

## Secrets

All four are GitHub Actions repository secrets. `gh secret list` shows their names and update times, never
their values.

| Secret | Mapped to | Must be |
|---|---|---|
| `CLERK_TEST_SECRET_KEY` | `CLERK_SECRET_KEY` (build + test steps) | An `sk_test_` key from a Clerk **development** instance that is not the production one. |
| `CLERK_TEST_PUBLISHABLE_KEY` | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (build + test steps) | The matching `pk_test_` key. `next build` inlines it, so it has to be on the build step. |
| `E2E_CLERK_TEST_EMAIL` | `E2E_CLERK_TEST_EMAIL` (test step) | The seeded user's email. Use a `+clerk_test` address (see below). |
| `E2E_CLERK_TEST_PASSWORD` | `E2E_CLERK_TEST_PASSWORD` (test step) | That user's password. |

The production `CLERK_SECRET_KEY` / `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` secrets are never read by `ci.yml`,
and the e2e-tag-routing suite fails if that changes. The global setup refuses any key that does not start
with `sk_test_` / `pk_test_`.

### When the secrets are missing

`E2E_CLERK_TEST_REQUIRED` is computed the same way as `E2E_UPSTASH_TEST_REQUIRED`. It is `false` only for a
pull request from a fork or opened by Dependabot. Those runs get no repository secrets, so the specs skip
and the job passes. On every other run it is `true`: a missing secret fails the global setup, and a
skipped test fails the reporter. On those runs, a green job means the journey ran.

To rotate a value without it landing in shell history, let `gh` prompt for it:

```bash
gh secret set E2E_CLERK_TEST_PASSWORD --repo Tristan578/project-forge
```

## The seeded user

The spec signs in through the real `<SignIn>` form: email, **Continue**, password, **Continue**. The user
needs:

1. **Email and password sign-in.** The test instance must allow email address plus password, and the user
   must have a password. The global setup reads the user from the Backend API and stops with a named error
   if the user is missing or has no password.
2. **No multi-factor authentication.** The global setup rejects a user with two-factor enabled.
3. **A `+clerk_test` email address**, such as `spawnforge-e2e+clerk_test@<your-domain>`. A suffix after
   `+clerk_test` also counts (Clerk's own Playwright example uses `testuser+clerk_test_123@example.com`,
   [docs](https://clerk.com/docs/guides/development/testing/playwright/test-sign-up-flows)). Clerk's Device
   Trust asks for a second factor when a user enters a valid password, has not enabled MFA, and signs in
   from a new device. It is on by default for applications created after November 14, 2025
   ([docs](https://clerk.com/docs/guides/secure/device-trust)). Every CI browser is a new device. On a
   development instance, a `+clerk_test` address receives no email and accepts the fixed code `424242`
   ([docs](https://clerk.com/docs/guides/development/testing/test-emails-and-phones)), which the spec enters
   when Clerk asks. Any other address cannot finish the journey once Device Trust applies. The global setup
   logs `+clerk_test address: yes|no` so the log shows which kind of address is configured.
4. **Device Trust set to email code, if it is on.** Clerk picks "an email code, SMS code, or email link based
   on your settings". The spec types a code into the field named **Enter verification code**, so it can
   finish only the email-code method.

### Creating the user

In the Clerk Dashboard, open the **test** instance, go to **Users → Create user**, and enter the email and
password above. Or use the Backend API with the test instance's secret key:

```bash
# Enter the key at the prompt so it stays out of shell history.
read -rs CLERK_TEST_SECRET_KEY
curl -sS -X POST https://api.clerk.com/v1/users \
  -H "Authorization: Bearer $CLERK_TEST_SECRET_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email_address":["spawnforge-e2e+clerk_test@<your-domain>"],"password":"<a generated password>"}'
```

Then set `E2E_CLERK_TEST_EMAIL` and `E2E_CLERK_TEST_PASSWORD` to match.

## Running it locally

You need the test instance's keys in your shell (not in a committed file). The build step bakes in the
publishable key:

```bash
cd web
export NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...   # test instance only
export CLERK_SECRET_KEY=sk_test_...                    # test instance only
export E2E_CLERK_TEST_EMAIL=... E2E_CLERK_TEST_PASSWORD=...
SKIP_ENV_VALIDATION=true npx next build
SKIP_ENV_VALIDATION=true STAGING_URL=http://localhost:3000 npx playwright test --config playwright.auth.config.ts
```

`STAGING_URL` matters. The proxy passes `buildAuthorizedParties()` to `clerkMiddleware`, which rejects a
session token whose `azp` claim is not in that list. Under `next start`, the list holds the production
origins plus `STAGING_URL`. Without it, a session created on `http://localhost:3000` looks signed out to the
server, and `/dashboard` redirects back to sign-in.

If the keys are not set, the global setup prints `skipping Clerk setup` and both tests skip. Set
`E2E_CLERK_TEST_REQUIRED=true` to make that a failure instead.

## Failure messages

| Message (build step, global setup or spec) | Cause |
|---|---|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is set but unusable: its prefix is right but the payload does not decode…` (the **Build for auth E2E** step) | `CLERK_TEST_PUBLISHABLE_KEY` has a publishable-key prefix but is not a real Clerk publishable key: it is truncated, a placeholder, or has extra characters. Whitespace is not the cause, because the check trims first. Copy the key again from the test instance's **API keys** page and re-set the secret. |
| `E2E_CLERK_TEST_REQUIRED=true but CLERK_SECRET_KEY … is empty` | A test-instance key secret was deleted or renamed. |
| `Refusing to run the Clerk auth journey against a non-development instance` | A key that is not `sk_test_` / `pk_test_` was supplied. |
| `Clerk testing-token request (POST /v1/testing_tokens) failed: HTTP 401` | The secret key is wrong or was rotated. |
| `The Clerk test instance has no user with the E2E_CLERK_TEST_EMAIL address` | The seeded user was deleted, or the email secret changed. Recreate the user as above. |
| `… has no password` / `… has two-factor authentication enabled` | The user does not meet the requirements above. |
| `Clerk asked for an email verification code (Device Trust) and E2E_CLERK_TEST_EMAIL is not a +clerk_test address` | Reseed the user with a `+clerk_test` address. |
| `[requiredRunReporter] FAIL: N test(s) skipped on a run that requires Clerk` | A test skipped on a trusted run. Find the `test.skip` that fired. |
| `/dashboard` expected but the URL is the sign-in page | The server rejected the session. Check `STAGING_URL` on the test step first. |
