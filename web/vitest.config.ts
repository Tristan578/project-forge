import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'jsdom',
    testTimeout: 10000,
    hookTimeout: 10000,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
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
      // Final target: 55/45/50/55
      thresholds: {
        statements: 44,
        branches: 36,
        functions: 39,
        lines: 45,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
