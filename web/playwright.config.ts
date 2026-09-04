import { defineConfig, devices } from '@playwright/test';
import {
  E2E_TEST_TIMEOUT_MS,
  E2E_EXPECT_TIMEOUT_MS,
  E2E_ACTION_TIMEOUT_MS,
  E2E_NAVIGATION_TIMEOUT_MS,
  E2E_WEB_SERVER_TIMEOUT_MS,
} from './src/lib/config/timeouts';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'html',
  timeout: E2E_TEST_TIMEOUT_MS,
  expect: { timeout: E2E_EXPECT_TIMEOUT_MS },

  use: {
    baseURL: 'http://localhost:3000',
    actionTimeout: E2E_ACTION_TIMEOUT_MS,
    navigationTimeout: E2E_NAVIGATION_TIMEOUT_MS,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // Disable GPU for all E2E tests — @ui tests don't need it, and WebGPU/Vulkan
    // flags crash headless Chrome even when engine loading is skipped.
    // @engine tests requiring GPU should use a dedicated project config.
    launchOptions: { args: ['--disable-gpu', '--no-sandbox'] },
  },

  // Chromium only. firefox, webkit, mobile-iphone and mobile-pixel used to be
  // declared here and were executed by no workflow for months (#9610) — the
  // cross-browser coverage this file advertised was a label. They now live in
  // playwright.crossbrowser.config.ts, which CI actually runs, and are matched
  // per-config by scripts/__tests__/e2e-tag-routing.test.sh so a name declared
  // in one file can no longer be credited by another file's execution.
  //
  // Removing them also removed a live defect: the global launchOptions below
  // are Chromium flags, and every project overrode them EXCEPT mobile-iphone —
  // an iPhone 14 device descriptor whose defaultBrowserType is 'webkit'. Anyone
  // running `--project=mobile-iphone` handed --disable-gpu/--no-sandbox to a
  // WebKit launch.
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: {
    command: 'npm run dev:raw',
    url: 'http://localhost:3000/dev',
    reuseExistingServer: !process.env.CI,
    timeout: E2E_WEB_SERVER_TIMEOUT_MS,
  },
});
