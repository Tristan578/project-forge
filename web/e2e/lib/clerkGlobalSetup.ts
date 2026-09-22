/**
 * Playwright globalSetup for the Clerk-keyed auth-journey job (#8632).
 *
 * Wired ONLY into `playwright.auth.config.ts`. It does what `@clerk/testing`'s
 * `clerkSetup()` does — fetch a testing token with the secret key and publish
 * it, with the Frontend API host, as `CLERK_TESTING_TOKEN` / `CLERK_FAPI` for
 * the workers (Playwright propagates `process.env` changes made here) — plus
 * two checks that are specific to this repo:
 *
 *   - `planClerkTesting()` refuses anything but `sk_test_`/`pk_test_` keys, and
 *     fails a REQUIRED run (trusted CI) that has no keys instead of skipping.
 *     With no keys on an optional run (fork PR, local) it returns early
 *     WITHOUT throwing, and every @auth test skips.
 *   - The seeded user is looked up before any browser starts, so a deleted
 *     user, a passwordless one, or one with MFA fails here with its cause named
 *     rather than as a sign-in form timing out 30 seconds later.
 *
 * The secret key and the token are never logged.
 */
import {
  CLERK_FAPI_ENV,
  CLERK_TESTING_TOKEN_ENV,
  createTestingToken,
  findSeededUser,
  isClerkTestEmail,
  planClerkTesting,
  type SeededUserSummary,
} from './clerkTesting';

const RUNBOOK = 'docs/guides/e2e-clerk-test-user.md';

export interface ClerkSetupDeps {
  createTestingToken: (secretKey: string) => Promise<string>;
  findSeededUser: (secretKey: string, email: string) => Promise<SeededUserSummary | null>;
  log: (message: string) => void;
}

const defaultDeps: ClerkSetupDeps = {
  createTestingToken: (secretKey) => createTestingToken(secretKey),
  findSeededUser: (secretKey, email) => findSeededUser(secretKey, email),
  log: (message) => console.log(message),
};

/**
 * Resolve the Clerk plan and, when it runs, publish the testing token.
 * @param env Environment to read and to publish into (normally `process.env`).
 * @param deps Clerk Backend API calls and logging, injectable for tests.
 */
export async function prepareClerkTesting(
  env: Record<string, string | undefined>,
  deps: ClerkSetupDeps = defaultDeps,
): Promise<void> {
  const plan = planClerkTesting(env);
  if (plan.mode === 'skip') {
    deps.log(`[clerk-testing] skipping Clerk setup: ${plan.reason}`);
    return;
  }

  const token = await deps.createTestingToken(plan.secretKey);

  if (plan.credentials) {
    const user = await deps.findSeededUser(plan.secretKey, plan.credentials.email);
    if (!user) {
      throw new Error(
        `The Clerk test instance has no user with the E2E_CLERK_TEST_EMAIL address. Seed it as described in ${RUNBOOK}.`,
      );
    }
    if (!user.passwordEnabled) {
      throw new Error(
        `The seeded Clerk test user (${user.id}) has no password, so it cannot sign in through the form. ` +
          `Set one as described in ${RUNBOOK}.`,
      );
    }
    if (user.twoFactorEnabled) {
      throw new Error(
        `The seeded Clerk test user (${user.id}) has two-factor authentication enabled, which the journey ` +
          `cannot complete. Disable it as described in ${RUNBOOK}.`,
      );
    }
    deps.log(
      `[clerk-testing] seeded user ${user.id} found; +clerk_test address: ` +
        `${isClerkTestEmail(plan.credentials.email) ? 'yes' : 'no'}.`,
    );
  } else {
    deps.log('[clerk-testing] no seeded-user credentials; the sign-in journey test will skip.');
  }

  env[CLERK_FAPI_ENV] = plan.frontendApi;
  env[CLERK_TESTING_TOKEN_ENV] = token;
  deps.log(
    `[clerk-testing] testing token issued for ${plan.frontendApi} ` +
      `(E2E_CLERK_TEST_REQUIRED=${plan.required ? 'true' : 'false'}).`,
  );
}

/** Playwright entry point. */
export default async function clerkGlobalSetup(): Promise<void> {
  await prepareClerkTesting(process.env);
}
