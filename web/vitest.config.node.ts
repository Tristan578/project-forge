/** Select server and unit suites in Node while the root enforces aggregate coverage. */
import { defineConfig } from 'vitest/config';
import path from 'path';
import { VITEST_TEST_TIMEOUT_MS, VITEST_HOOK_TIMEOUT_MS } from './src/lib/config/timeouts';
import { NODE_TEST_EXCLUDE, NODE_TEST_INCLUDE } from './vitest.test-selection';

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
    include: NODE_TEST_INCLUDE,
    exclude: NODE_TEST_EXCLUDE,
    setupFiles: ['./vitest.setup.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
