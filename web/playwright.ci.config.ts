/**
 * Playwright config for CI — uses next start (production server) instead
 * of next dev. The production server boots in <5s vs 2-3min for dev mode,
 * preventing the 30-minute CI timeout.
 *
 * Requires: npx next build run BEFORE playwright (CI workflow handles this).
 * Requires: SKIP_ENV_VALIDATION=true (no Clerk/Stripe keys in CI).
 */
import { defineConfig, devices } from '@playwright/test';
import {
  E2E_NAVIGATION_TIMEOUT_MS,
} from './src/lib/config/timeouts';

/** CI-specific: tighter than the default E2E_TEST_TIMEOUT_MS (60s) since UI-only tests don't need WASM load time */
const CI_TEST_TIMEOUT_MS = 30_000;
const CI_EXPECT_TIMEOUT_MS = 10_000;

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: true,
  retries: 1,
  workers: 4,
  maxFailures: 10,
  reporter: [['github'], ['html', { open: 'never' }]],
  timeout: CI_TEST_TIMEOUT_MS,
  expect: { timeout: CI_EXPECT_TIMEOUT_MS },

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
