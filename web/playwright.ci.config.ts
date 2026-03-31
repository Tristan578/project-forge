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
  E2E_TEST_TIMEOUT_MS,
  E2E_NAVIGATION_TIMEOUT_MS,
} from './src/lib/config/timeouts';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: true,
  retries: 2,
  workers: 2,
  reporter: [['github'], ['html', { open: 'never' }]],
  timeout: E2E_TEST_TIMEOUT_MS,
  expect: { timeout: 15_000 },

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
