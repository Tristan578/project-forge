import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: [
      'scripts/__tests__/**/*.test.ts',
      'lib/__tests__/**/*.test.ts',
      'components/__tests__/**/*.test.tsx',
    ],
    environmentMatchGlobs: [
      // React component tests need jsdom
      ['components/__tests__/**', 'jsdom'],
      // Node scripts and pure-TS lib tests run in node
      ['scripts/__tests__/**', 'node'],
      ['lib/__tests__/**', 'node'],
    ],
  },
});
