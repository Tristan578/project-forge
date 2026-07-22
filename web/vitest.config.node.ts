import { defineConfig } from 'vitest/config';
import path from 'path';
import { VITEST_TEST_TIMEOUT_MS, VITEST_HOOK_TIMEOUT_MS } from './src/lib/config/timeouts';

export default defineConfig({
  test: {
    name: 'node-tests',
    environment: 'node',
    pool: 'threads',
    testTimeout: VITEST_TEST_TIMEOUT_MS,
    hookTimeout: VITEST_HOOK_TIMEOUT_MS,
    teardownTimeout: 5000,
    isolate: true,
    retry: process.env.CI ? 1 : 0,
    include: [
      'src/lib/**/*.test.ts',
      'src/lib/**/*.test.tsx',
      'src/stores/**/*.test.ts',
      'src/stores/**/*.test.tsx',
      'src/app/api/**/*.test.ts',
      'src/app/api/**/*.test.tsx',
      'src/__integration__/**/*.test.ts',
      'src/__integration__/**/*.test.tsx',
      // Top-level src/__tests__ (proxy.test.ts, instrumentation.test.ts):
      // without this glob these suites only ran under the standalone
      // vitest.config.ts, never in the workspace gate.
      'src/__tests__/**/*.test.ts',
      'src/__tests__/**/*.test.tsx',
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
      // Kept in lockstep with vitest.config.ts by the coverage ratchet
      // (PF-996) — do not edit by hand.
      thresholds: {
        statements: 81,
        branches: 71,
        functions: 75,
        lines: 82,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
