/**
 * Playwright config for production smoke tests.
 *
 * Unlike the main playwright.config.ts, this config does NOT start a local
 * dev server. Smoke tests run against the live production URL (PRODUCTION_URL
 * env var) to verify the actual deployed site works.
 *
 * Used by: .github/workflows/cd.yml → "Run production smoke tests"
 * Run manually: PRODUCTION_URL=https://www.spawnforge.ai npx playwright test --config playwright.smoke.config.ts
 */
import { defineConfig, devices } from '@playwright/test';

const PRODUCTION_URL = process.env.PRODUCTION_URL || 'https://www.spawnforge.ai';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/production-smoke.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 1,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'html',
  timeout: 30_000,
  expect: { timeout: 15_000 },

  use: {
    baseURL: PRODUCTION_URL,
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    launchOptions: { args: ['--disable-gpu', '--no-sandbox'] },
    // Deliberately NO `extraHTTPHeaders` bypass here: that option attaches a
    // header to every request from both contexts, and this suite also fetches
    // engine.spawnforge.ai and drives a real browser through Clerk, PostHog and
    // Sentry hosts — a Deployment Protection bypass secret must never reach
    // them. If a protected URL ever has to be smoke-tested, scope the
    // `x-vercel-protection-bypass` header to that origin per request.
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // No webServer — smoke tests hit the live production URL directly
});
