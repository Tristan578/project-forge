import { defineConfig } from 'vitest/config';
import path from 'path';
import { VITEST_TEST_TIMEOUT_MS, VITEST_HOOK_TIMEOUT_MS } from './src/lib/config/timeouts';
import { JSDOM_TEST_EXCLUDE, JSDOM_TEST_INCLUDE } from './vitest.test-selection';

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
    // Force Vite to bundle @sentry/nextjs so its bare-specifier imports
    // (e.g. `import "next/router"` without extension) go through Vite's
    // resolver instead of Node's strict ESM loader.
    server: {
      deps: {
        inline: [/@sentry\/nextjs/],
      },
    },
    include: JSDOM_TEST_INCLUDE,
    exclude: JSDOM_TEST_EXCLUDE,
    setupFiles: ['./vitest.setup.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // @sentry/nextjs >= 10.50 imports `next/router` (legacy pages router) as a
      // bare specifier without extension, which vitest's strict ESM resolver
      // rejects. Next 16 has no `exports` field, so we point at the file directly.
      'next/router': path.resolve(__dirname, '../node_modules/next/router.js'),
    },
    // Resolve @spawnforge/ui from TS source instead of dist/, so vitest works
    // in clean checkouts where packages/ui hasn't been built yet.
    conditions: ['development', 'import', 'module', 'browser', 'default'],
  },
});
