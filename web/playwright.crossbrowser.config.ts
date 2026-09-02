/**
 * Playwright config for the cross-browser CI job (#9610).
 *
 * firefox, webkit and the two mobile projects were declared in
 * playwright.config.ts for months and executed by nothing: every workflow
 * passed --project=chromium or a chromium-only config, so the cross-browser
 * coverage the default config advertised was a label. This config runs the
 * same @ui selection as playwright.ci.config.ts on the other engines, against
 * the same production server (`next build` + `next start`).
 *
 * There is deliberately NO global `launchOptions`: `--disable-gpu` and
 * `--no-sandbox` are Chromium flags, and a Firefox/WebKit launch given them
 * fails before the first test. Only the Pixel 7 project (a Chromium
 * emulation) carries them.
 *
 * Linux WebKit is what Playwright ships and installs (`e2e:install` already
 * pulls it); no macOS runner is involved. The engine's SwiftShader flags are
 * Chromium-only, so WebGPU-on-Safari is out of reach here by design — this is
 * the UI surface, not the canvas.
 *
 * Requires: npx next build run BEFORE playwright (CI workflow handles this).
 * Requires: SKIP_ENV_VALIDATION=true (no Clerk/Stripe keys in CI).
 */
import { defineConfig, devices } from '@playwright/test';
import {
  E2E_NAVIGATION_TIMEOUT_MS,
} from './src/lib/config/timeouts';

const CI_TEST_TIMEOUT_MS = 30_000;
const CI_EXPECT_TIMEOUT_MS = 10_000;

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: true,
  retries: 1,
  // Four engines share one runner; two workers keeps WebKit from starving.
  workers: 2,
  maxFailures: 20,
  reporter: [['github'], ['html', { open: 'never', outputFolder: 'playwright-report-crossbrowser' }]],
  timeout: CI_TEST_TIMEOUT_MS,
  expect: { timeout: CI_EXPECT_TIMEOUT_MS },

  use: {
    baseURL: 'http://localhost:3000',
    actionTimeout: 10_000,
    navigationTimeout: E2E_NAVIGATION_TIMEOUT_MS,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'], launchOptions: { args: [] } },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'], launchOptions: { args: [] } },
    },
    {
      name: 'mobile-iphone',
      use: { ...devices['iPhone 14'], launchOptions: { args: [] } },
    },
    {
      name: 'mobile-pixel',
      // Pixel 7 is a Chromium emulation, so the Chromium-only flags apply.
      use: { ...devices['Pixel 7'], launchOptions: { args: ['--disable-gpu', '--no-sandbox'] } },
    },
  ],

  webServer: {
    command: 'npx next start',
    url: 'http://localhost:3000/api/health',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
