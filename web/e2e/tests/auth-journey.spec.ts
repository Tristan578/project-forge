import { test, expect } from '@playwright/test';
import { clerkTestingEnv, installClerkTestingToken, signInThroughForm } from '../helpers/clerkSession';
import { E2E_TIMEOUT_AUTH_MS, E2E_TIMEOUT_LOAD_MS } from '../constants';

/**
 * The signup/auth journey against a real Clerk TEST instance (#8632, F40).
 *
 * Runs ONLY in CI's `test-e2e-auth` job, through `playwright.auth.config.ts`,
 * whose global setup (`e2e/lib/clerkGlobalSetup.ts`) issues a Clerk testing
 * token and publishes it for these workers. These specs are tagged `@auth`,
 * not `@ui`, on purpose: the @ui shard runs with NO Clerk keys, because keys
 * there would switch the proxy to clerkMiddleware for every editor spec and,
 * under `next start` (NODE_ENV=production), take `/dev` out of the public
 * routes (`buildPublicRoutes({ includeDev: false })` in src/proxy.ts).
 *
 * Without keys (fork PRs, a local run) the whole block skips. On trusted CI
 * (`E2E_CLERK_TEST_REQUIRED=true`) a skip is impossible by construction: the
 * global setup throws when keys are missing, and `requiredRunReporter` fails
 * the run if any test here reports `skipped`.
 */
test.describe('Auth journey @auth', () => {
  const clerk = clerkTestingEnv();
  test.skip(clerk === null, 'Clerk test-instance keys are not configured (see docs/guides/e2e-clerk-test-user.md)');

  test.beforeEach(async ({ context }) => {
    if (clerk) await installClerkTestingToken(context, clerk);
  });

  test('pricing page Sign In button opens the Clerk sign-in form', async ({ page }) => {
    await page.goto('/pricing');

    const signInButton = page.getByRole('button', { name: /sign in/i });
    await expect(signInButton).toBeVisible({ timeout: E2E_TIMEOUT_LOAD_MS });
    await signInButton.click();

    // The button calls router.push('/sign-in'); waitForURL waits for the
    // client-side navigation, which waitForLoadState would not.
    await page.waitForURL('**/sign-in**', { timeout: E2E_TIMEOUT_LOAD_MS });
    // The URL alone is not the journey: /sign-in renders an empty shell when
    // the Clerk provider is not configured. The form a person types into is.
    await expect(page.locator('input[name="identifier"]')).toBeVisible({ timeout: E2E_TIMEOUT_AUTH_MS });
  });

  test('seeded test user signs in and reaches the signed-in dashboard', async ({ page }) => {
    const email = process.env.E2E_CLERK_TEST_EMAIL ?? '';
    const password = process.env.E2E_CLERK_TEST_PASSWORD ?? '';
    test.skip(!email || !password, 'E2E_CLERK_TEST_EMAIL / E2E_CLERK_TEST_PASSWORD are not configured');

    const { verificationCodeRequested } = await signInThroughForm(page, { email, password });
    test.info().annotations.push({
      type: 'clerk-verification-code',
      description: verificationCodeRequested ? 'requested (Device Trust) and entered' : 'not requested',
    });

    // <SignIn fallbackRedirectUrl="/"> sends the browser to /, and the proxy
    // redirects a signed-in visitor on / to /dashboard — so landing here means
    // the SERVER verified the new session, including its azp claim.
    await expect(page).toHaveURL(/\/dashboard(\?.*)?$/, { timeout: E2E_TIMEOUT_AUTH_MS });
    // DashboardPage redirects to /sign-in unless safeAuth() returns a userId,
    // so its heading only renders for a signed-in request.
    await expect(page.getByRole('heading', { name: 'My Projects' })).toBeVisible({ timeout: E2E_TIMEOUT_LOAD_MS });

    // And the client agrees: the pricing header swaps Sign In for Dashboard
    // once Clerk reports a session.
    await page.goto('/pricing');
    await expect(page.getByRole('button', { name: 'Dashboard' })).toBeVisible({ timeout: E2E_TIMEOUT_LOAD_MS });
    await expect(page.getByRole('button', { name: /sign in/i })).toHaveCount(0);
  });
});
