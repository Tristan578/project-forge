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
      // Ratcheted up per sprint — must match vitest.config.ts thresholds
      thresholds: {
        statements: 70,
        branches: 60,
        functions: 65,
        lines: 72,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
