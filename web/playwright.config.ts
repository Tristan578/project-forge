import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'html',
  timeout: process.env.CI ? 60_000 : 30_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // In CI, run headed inside xvfb so Chrome gets a real display + GPU context.
    // Headless mode disables GPU even with SwiftShader flags.
    headless: !process.env.CI,
    launchOptions: {
      args: [
        '--enable-unsafe-webgpu',
        '--enable-features=Vulkan',
        // CI: Force WebGL2 path via SwiftShader (no real GPU available).
        // --disable-webgpu removes navigator.gpu so the app uses WebGL2 fallback.
        // ANGLE + SwiftShader provides software WebGL2 rendering.
        ...(process.env.CI
          ? [
              '--disable-webgpu',
              '--use-gl=angle',
              '--use-angle=swiftshader-webgl',
              '--disable-gpu-sandbox',
              '--no-sandbox',
            ]
          : []),
      ],
    },
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],

  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000/dev',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
