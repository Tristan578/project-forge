import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'html',
  timeout: 60_000,
  expect: { timeout: 15_000 },

  use: {
    baseURL: 'http://localhost:3000',
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
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
    command: 'npm run dev',
    url: 'http://localhost:3000/dev',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
