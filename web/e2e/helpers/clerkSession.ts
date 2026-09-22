/**
 * Playwright wiring for the Clerk auth-journey specs (#8632).
 *
 * `installClerkTestingToken` is the hand-rolled counterpart of
 * `@clerk/testing/playwright`'s `setupClerkTestingToken`: every Frontend API
 * request (`https://<frontendApi>/v1/…`) leaves the browser with the testing
 * token in `__clerk_testing_token`, and JSON responses have `captcha_bypass`
 * flipped the same way that package does. The pure halves (URL rewrite,
 * payload rewrite) are unit-tested in `../lib/__tests__/clerkTesting.test.ts`.
 *
 * `signInThroughForm` drives the real `<SignIn>` form a person uses: email,
 * Continue, password, Continue. Clerk's Device Trust ("automatically enabled
 * for Clerk applications created after November 14, 2025",
 * https://clerk.com/docs/guides/secure/client-trust) asks a password sign-in
 * from a new device — which every CI browser is — for an email code. On a
 * development instance a `+clerk_test` address takes the fixed code 424242, so
 * the journey completes; any other address cannot, and the helper says so.
 */
import { expect, type BrowserContext, type Page } from '@playwright/test';
import {
  CLERK_FAPI_ENV,
  CLERK_TESTING_TOKEN_ENV,
  CLERK_TEST_EMAIL_CODE,
  bypassCaptcha,
  isClerkTestEmail,
  withTestingToken,
  type SeededUserCredentials,
} from '../lib/clerkTesting';
import { E2E_TIMEOUT_AUTH_MS, E2E_TIMEOUT_NAV_MS } from '../constants';

export interface ClerkTestingEnv {
  frontendApi: string;
  token: string;
}

/**
 * The Frontend API host and testing token published by `clerkGlobalSetup`, or
 * null when that setup skipped (no keys) or never ran (another config).
 * @returns The published values, or null.
 */
export function clerkTestingEnv(): ClerkTestingEnv | null {
  const frontendApi = process.env[CLERK_FAPI_ENV] ?? '';
  const token = process.env[CLERK_TESTING_TOKEN_ENV] ?? '';
  return frontendApi && token ? { frontendApi, token } : null;
}

/**
 * Route every Frontend API request of `context` through the testing token.
 * @param context Browser context to install the route on.
 * @param env Values from {@link clerkTestingEnv}.
 */
export async function installClerkTestingToken(context: BrowserContext, env: ClerkTestingEnv): Promise<void> {
  const { frontendApi, token } = env;
  await context.route(
    (url) => withTestingToken(url.toString(), frontendApi, token) !== null,
    async (route) => {
      const request = route.request();
      const url = withTestingToken(request.url(), frontendApi, token);
      if (url === null) {
        await route.continue();
        return;
      }
      // A top-level navigation to the Frontend API (Clerk's dev-instance
      // handshake) answers with a redirect back to the app; let the browser
      // follow it natively rather than re-serving a followed response under the
      // Frontend API URL.
      if (request.isNavigationRequest()) {
        await route.continue({ url });
        return;
      }
      const response = await route.fetch({ url });
      const contentType = response.headers()['content-type'] ?? '';
      if (!contentType.includes('application/json')) {
        await route.fulfill({ response });
        return;
      }
      const json: unknown = await response.json();
      bypassCaptcha(json);
      await route.fulfill({ response, json });
    },
  );
}

export interface SignInResult {
  /** True when Clerk asked for an email code (Device Trust) before signing in. */
  verificationCodeRequested: boolean;
}

/**
 * Sign the seeded user in through the `/sign-in` form and wait until the
 * browser has left `/sign-in`.
 * @param page Page whose context already has the testing token installed.
 * @param credentials The seeded user's email and password.
 * @returns Whether a verification code was needed.
 */
export async function signInThroughForm(page: Page, credentials: SeededUserCredentials): Promise<SignInResult> {
  await page.goto('/sign-in');

  const identifier = page.locator('input[name="identifier"]');
  // clerk-js is fetched from the Frontend API CDN on first load, so the form
  // mounts later than the page does.
  await expect(identifier).toBeVisible({ timeout: E2E_TIMEOUT_AUTH_MS });
  await identifier.fill(credentials.email);

  const continueButton = page.getByRole('button', { name: 'Continue', exact: true });
  // Clerk keeps a HIDDEN password input on the first step for password-manager
  // autofill; only a visible one is the field a person types into.
  const password = page.locator('input[name="password"]:visible');
  if ((await password.count()) === 0) {
    await continueButton.click();
    await expect(password).toBeVisible({ timeout: E2E_TIMEOUT_NAV_MS });
  }
  await password.fill(credentials.password);
  await continueButton.click();

  const verificationStep = /^\/sign-in\/(client-trust|factor-two)(\/|$)/;
  await page.waitForURL((url) => !url.pathname.startsWith('/sign-in') || verificationStep.test(url.pathname), {
    timeout: E2E_TIMEOUT_AUTH_MS,
  });

  const verificationCodeRequested = verificationStep.test(new URL(page.url()).pathname);
  if (verificationCodeRequested) {
    if (!isClerkTestEmail(credentials.email)) {
      throw new Error(
        'Clerk asked for an email verification code (Device Trust) and E2E_CLERK_TEST_EMAIL is not a ' +
          '+clerk_test address, so no code can be entered. Reseed the test user with a +clerk_test address ' +
          '(docs/guides/e2e-clerk-test-user.md).',
      );
    }
    const code = page.getByRole('textbox', { name: 'Enter verification code' });
    await expect(code).toBeVisible({ timeout: E2E_TIMEOUT_NAV_MS });
    await code.pressSequentially(CLERK_TEST_EMAIL_CODE);
    await page.waitForURL((url) => !url.pathname.startsWith('/sign-in'), { timeout: E2E_TIMEOUT_AUTH_MS });
  }

  return { verificationCodeRequested };
}
