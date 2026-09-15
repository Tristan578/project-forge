/** Isolate scanner unit, report, and CLI tests from application test suites. */
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  test: {
    environment: 'node',
    include: ['__tests__/**/*.test.ts'],
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
});
