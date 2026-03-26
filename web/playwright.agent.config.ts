/**
 * Playwright configuration for AI agent viewport tests.
 *
 * Differences from playwright.config.ts:
 * - Single `agent-chromium` project with SwiftShader software rendering
 *   (`--use-angle=swiftshader`) for reliable headless WebGL2 without a GPU.
 * - testMatch: agent-*.spec.ts — only picks up agent-specific tests.
 * - No `webServer` block — the agent manages its own dev server lifecycle.
 * - Output goes to `e2e/agent-results/` (gitignored per .gitignore).
 * - 120s timeout for agent tasks that involve scene building + verification.
 *
 * Security (A3): `e2e/agent-results/` is gitignored to prevent accidental
 * commit of canvas captures, screenshots, or scene data.
 *
 * Run with: cd web && npx playwright test --config playwright.agent.config.ts
 */

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/agent-*.spec.ts',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never', outputFolder: 'e2e/agent-results/report' }]]
    : [['html', { open: 'never', outputFolder: 'e2e/agent-results/report' }]],
  outputDir: 'e2e/agent-results',
  timeout: 120_000,
  expect: { timeout: 20_000 },

  use: {
    baseURL: process.env.AGENT_BASE_URL ?? 'http://localhost:3000',
    actionTimeout: 15_000,
    navigationTimeout: 60_000,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // SwiftShader software renderer: enables WebGL2 in headless Chrome without
    // a physical GPU. Agents verify what they build — we need canvas rendering.
    launchOptions: {
      args: [
        '--enable-webgl',
        '--use-angle=swiftshader',
        '--no-sandbox',
        '--disable-dev-shm-usage',
      ],
    },
  },

  projects: [
    {
      name: 'agent-chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // No webServer block — the agent manages dev server lifecycle.
  // Run `cd web && npm run dev` before executing agent tests.
});
