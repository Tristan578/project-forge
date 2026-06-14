/**
 * Playwright config for the STRICT interactive-journey CI gate (#8601 / #8604).
 *
 * Unlike playwright.ci.config.ts (the @ui shard), this config runs ONLY the
 * curated `@journey` specs and demands a fully-exposed store surface. It is the
 * required CI job that proves the core new-user journey — idea -> generated scene
 * -> entities spawn -> Play -> winnable -> export — survives on the SAME
 * production server users hit (`next build` + `next start`).
 *
 * Two non-negotiables make the gate real instead of decorative:
 *   1. The prod build MUST be compiled with `NEXT_PUBLIC_E2E_HOOKS=true` so the
 *      editor/chat stores are exposed on `window` (see `e2eHooksEnabled`). A
 *      normal deploy never sets that flag, so this exposure is CI-only.
 *   2. The run MUST set `E2E_STRICT_STORES=true` so the store-injection helpers
 *      THROW (rather than skip) when a store or assertion target is missing —
 *      a regression surfaces as a red gate, never as a silently-skipped test.
 *
 * Requires: `NEXT_PUBLIC_E2E_HOOKS=true npx next build` run BEFORE playwright
 * (the CI workflow handles this), and `SKIP_ENV_VALIDATION=true` (no Clerk/
 * Stripe keys in CI).
 */
import { defineConfig, devices } from '@playwright/test';
import { E2E_NAVIGATION_TIMEOUT_MS } from './src/lib/config/timeouts';

/** Journey tests run against a prod server without WASM; keep timeouts tight so a hang fails fast. */
const JOURNEY_TEST_TIMEOUT_MS = 45_000;
const JOURNEY_EXPECT_TIMEOUT_MS = 10_000;

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  grep: /@journey/,
  fullyParallel: true,
  forbidOnly: true,
  // One retry absorbs a transient nav blip; a genuine journey break still fails
  // (it fails on the retry too) — this does NOT mask real regressions.
  retries: 1,
  workers: 2,
  // No maxFailures cap: the gate should report EVERY broken journey stage, not
  // bail after the first.
  // This gate runs on a single (non-sharded) runner, so there is no blob-merge
  // step — emit the standalone HTML report directly (uploaded as an artifact).
  reporter: [['github'], ['html', { open: 'never' }]],
  timeout: JOURNEY_TEST_TIMEOUT_MS,
  expect: { timeout: JOURNEY_EXPECT_TIMEOUT_MS },

  use: {
    baseURL: 'http://localhost:3000',
    actionTimeout: 10_000,
    navigationTimeout: E2E_NAVIGATION_TIMEOUT_MS,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
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
    url: 'http://localhost:3000/api/health',
    reuseExistingServer: false,
    timeout: 30_000, // next start boots in <5s after build
  },
});
