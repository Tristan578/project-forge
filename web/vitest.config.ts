import { defineConfig } from 'vitest/config';
import path from 'path';
import { VITEST_TEST_TIMEOUT_MS, VITEST_HOOK_TIMEOUT_MS } from './src/lib/config/timeouts';

export default defineConfig({
  test: {
    environment: 'jsdom',
    testTimeout: VITEST_TEST_TIMEOUT_MS,
    hookTimeout: VITEST_HOOK_TIMEOUT_MS,
    // 'threads' is safe now that all test files use vi.stubEnv() / vi.unstubAllEnvs()
    // instead of directly reassigning process.env. Direct reassignment raced across
    // workers sharing the same process object under 'threads'.
    pool: 'threads',
    teardownTimeout: 5000,
    isolate: true,
    retry: process.env.CI ? 1 : 0,
    include: [
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
      // Pure-function unit tests for e2e lib utilities (no browser required)
      'e2e/lib/__tests__/**/*.test.ts',
    ],
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.spec.ts',
        'src/**/__tests__/**',
        'src/**/*.d.ts',
        'src/app/**/layout.tsx',
        'src/app/**/page.tsx',
      ],
      // Ratcheted up per sprint — see docs/coverage-plan.md
      // Tier-3 target: 75/65/70/77 (actual coverage ~76/67/70/78, leaving ~1-2pp headroom)
      thresholds: {
        statements: 75,
        branches: 65,
        functions: 70,
        lines: 77,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
