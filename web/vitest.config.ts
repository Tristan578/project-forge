/** Run both production test projects and enforce the sole aggregate coverage thresholds. */
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    // The root remains the production coverage gate. Projects make the
    // environment choice without weakening aggregate coverage enforcement.
    projects: ['./vitest.config.node.ts', './vitest.config.jsdom.ts'],
    // Keep the production gate's isolation and CI retry policy explicit even
    // though execution is delegated to projects.
    isolate: true,
    retry: process.env.CI ? 1 : 0,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'clover', 'json', 'json-summary'],
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.spec.ts',
        'src/**/__tests__/**',
        // Guard fixtures: run only by vitest.mockOnceGuard.fixtures.config.ts (#9542)
        'src/**/__fixtures__/**',
        'src/**/*.d.ts',
        'src/app/**/layout.tsx',
        'src/app/**/page.tsx',
      ],
      // Ratcheted up per sprint — see docs/coverage-plan.md
      // The thresholds below are the enforced minimums; CI coverage reports show current measurements.
      thresholds: {
        statements: 85,
        branches: 77,
        functions: 80,
        lines: 87,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
