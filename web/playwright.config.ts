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

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: {
        ...devices['Desktop Firefox'],
        // Override global launchOptions — --disable-gpu and --no-sandbox are Chromium-only
        launchOptions: { args: [] },
      },
    },
    {
      name: 'webkit',
      use: {
        ...devices['Desktop Safari'],
        // Override global launchOptions — --disable-gpu and --no-sandbox are Chromium-only
        launchOptions: { args: [] },
      },
    },
    {
      name: 'mobile-iphone',
      use: {
        ...devices['iPhone 14'],
      },
    },
    {
      name: 'mobile-pixel',
      use: {
        ...devices['Pixel 7'],
      },
    },
  ],

  webServer: {
    command: 'npm run dev:raw',
    url: 'http://localhost:3000/dev',
    reuseExistingServer: !process.env.CI,
    timeout: E2E_WEB_SERVER_TIMEOUT_MS,
  },
});
