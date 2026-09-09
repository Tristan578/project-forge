/**
 * Playwright config for CI — uses next start (production server) instead
 * of next dev. The production server boots in <5s vs 2-3min for dev mode,
 * preventing the 30-minute CI timeout.
 *
 * Requires: npx next build run BEFORE playwright (CI workflow handles this).
 * Requires: SKIP_ENV_VALIDATION=true (no Clerk/Stripe keys in CI).
 */
import { randomBytes } from 'node:crypto';
import { defineConfig, devices } from '@playwright/test';
import {
  E2E_NAVIGATION_TIMEOUT_MS,
} from './src/lib/config/timeouts';

/**
 * A client address for THIS process, from the RFC 3849 documentation range.
 *
 * Public API routes are rate-limited per client IP, and `rateLimitPublicRoute`
 * keys on the literal `unknown` when no forwarded-for header is present.
 * `next start` on localhost sets none, so without this every browser page load
 * — 4 workers x 3 shards, plus every other CI job sharing the one CI Upstash
 * database — counted against a single `public:capabilities:unknown` bucket.
 * That, not the size of the ceiling, is what 429'd the runner: run 33987394245
 * failed the same way with the limit already at 120 (#9725 p7).
 *
 * Playwright loads this config in each worker process, and the value is minted
 * at load, so workers do not share a bucket; being random, neither do
 * concurrent jobs or reruns. API probes isolate themselves per request in
 * `e2e/helpers/capabilities.ts`.
 */
const WORKER_CLIENT_ADDRESS =
  '2001:db8:' + randomBytes(12).toString('hex').match(/.{4}/g)!.join(':');

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
  reporter: [['github'], ['blob'], ['html', { open: 'never' }]],
  timeout: CI_TEST_TIMEOUT_MS,
  expect: { timeout: CI_EXPECT_TIMEOUT_MS },

  use: {
    baseURL: 'http://localhost:3000',
    extraHTTPHeaders: { 'x-forwarded-for': WORKER_CLIENT_ADDRESS },
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
