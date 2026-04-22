import { defineConfig } from 'vitest/config';
import path from 'path';
import { VITEST_TEST_TIMEOUT_MS, VITEST_HOOK_TIMEOUT_MS } from './src/lib/config/timeouts';

export default defineConfig({
  test: {
    name: 'jsdom-tests',
    environment: 'jsdom',
    pool: 'forks',
    testTimeout: VITEST_TEST_TIMEOUT_MS,
    hookTimeout: VITEST_HOOK_TIMEOUT_MS,
    teardownTimeout: 5000,
    isolate: true,
    retry: process.env.CI ? 1 : 0,
    include: [
      'src/components/**/*.test.ts',
      'src/components/**/*.test.tsx',
      'src/hooks/**/*.test.ts',
      'src/hooks/**/*.test.tsx',
    ],
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/components/**/*.ts', 'src/components/**/*.tsx', 'src/hooks/**/*.ts', 'src/hooks/**/*.tsx'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.test.tsx',
        'src/**/*.spec.ts',
        'src/**/__tests__/**',
        'src/**/*.d.ts',
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
    // Use development condition so @spawnforge/ui resolves to TS source,
    // allowing tests to run without a dist build. In Vite 6+, resolve.conditions
    // replaces (not extends) the defaults, so explicitly include module + browser
    // to preserve @sentry/nextjs ESM/CJS selection and other module-sensitive deps.
    conditions: ['development', 'module', 'browser'],
  },
});
