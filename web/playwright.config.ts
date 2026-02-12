import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 60000,
  use: {
    baseURL: 'http://localhost:3000',
    // Use headed mode so WebGPU/WebGL2 can work
    headless: false,
    // Give more time for WASM loading
    actionTimeout: 15000,
    launchOptions: {
      // Chrome flags for WebGPU support
      args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan'],
    },
  },
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        channel: 'chromium',
      },
    },
  ],
  // Don't start a dev server - assume it's already running
  expect: {
    timeout: 15000,
  },
});
