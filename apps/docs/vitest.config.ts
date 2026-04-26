import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    // Default to node environment — component tests use
    // `// @vitest-environment jsdom` inline directives.
    // environmentMatchGlobs was removed in vitest 4.x.
    environment: 'node',
    include: [
      'scripts/__tests__/**/*.test.ts',
      'lib/__tests__/**/*.test.ts',
      'components/__tests__/**/*.test.tsx',
      'app/__tests__/**/*.test.ts',
    ],
  },
});
