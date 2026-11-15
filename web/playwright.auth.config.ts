/**
 * Playwright config for the Clerk-keyed auth-journey CI job (#8632, F40).
 *
 * Why a separate job and config rather than Clerk keys on the @ui shard:
 * with valid keys the proxy switches to clerkMiddleware for EVERY request, and
 * under `next start` (NODE_ENV=production) `buildPublicRoutes()` drops `/dev`
 * from the public routes (src/proxy.ts). The editor fixture opens `/dev` for
 * every editor spec, so keys on the @ui shard would send hundreds of specs to
 * `/sign-in` and turn protected API calls into 401s. This config runs only the
 * `@auth` specs, against a build that has the Clerk TEST instance's keys.
 *
 *   - globalSetup (`e2e/lib/clerkGlobalSetup.ts`) refuses non-`sk_test_`/
 *     `pk_test_` keys, issues a Clerk testing token, checks the seeded user, and
 *     returns early WITHOUT throwing when there are no keys on an optional run.
 *   - `requiredRunReporter` fails a run with `E2E_CLERK_TEST_REQUIRED=true`
 *     (trusted CI) that skipped any test or passed fewer than two.
 *
 * Requires: `npx next build` with NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY set (it is
 * inlined at build time), and SKIP_ENV_VALIDATION=true (no database or Stripe
 * keys in this job). The CI workflow handles both.
 */
import { defineConfig, devices } from '@playwright/test';
import { E2E_NAVIGATION_TIMEOUT_MS } from './src/lib/config/timeouts';

/** Clerk's hosted UI loads from its CDN and signs in over the network; allow for it. */
const AUTH_TEST_TIMEOUT_MS = 60_000;
const AUTH_EXPECT_TIMEOUT_MS = 10_000;

export default defineConfig({
  testDir: './e2e',
  // Match only the file that carries @auth, so a parse error in an unrelated
  // spec cannot break this job's collection phase; `grep` keeps the selection
  // honest if that file ever grows non-@auth tests.
  testMatch: '**/auth-journey.spec.ts',
  grep: /@auth/,
  globalSetup: './e2e/lib/clerkGlobalSetup.ts',
  fullyParallel: false,
  forbidOnly: true,
  // One retry absorbs a transient Clerk network blip; a real auth regression
  // fails on the retry too.
  retries: 1,
  // One seeded user: serial runs keep its sessions from racing each other.
  workers: 1,
  reporter: [
    ['./e2e/lib/requiredRunReporter.ts', { minPassed: 2, summaryPath: 'auth-results/summary.json' }],
  ],
  timeout: AUTH_TEST_TIMEOUT_MS,
  expect: { timeout: AUTH_EXPECT_TIMEOUT_MS },

  use: {
    baseURL: 'http://localhost:3000',
    actionTimeout: 10_000,
    navigationTimeout: E2E_NAVIGATION_TIMEOUT_MS,
    // This journey enters a reusable password and exchanges session tokens.
    // Raw recordings/reports must never be uploaded from this public repository.
    trace: 'off',
    screenshot: 'off',
    video: 'off',
    launchOptions: { args: ['--disable-gpu', '--no-sandbox'] },
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: {
    command: 'npx next start',
    stdout: 'ignore',
    stderr: 'ignore',
    url: 'http://localhost:3000/api/health',
    reuseExistingServer: false,
    timeout: 30_000, // next start boots in <5s after build
  },
});
