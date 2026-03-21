import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    name: 'node-tests',
    environment: 'node',
    pool: 'threads',
    testTimeout: 10000,
    hookTimeout: 10000,
    teardownTimeout: 5000,
    isolate: true,
    retry: process.env.CI ? 1 : 0,
    include: [
      'src/lib/**/*.test.ts',
      'src/lib/**/*.test.tsx',
      'src/stores/**/*.test.ts',
      'src/stores/**/*.test.tsx',
      'src/app/**/*.test.ts',
      'src/app/**/*.test.tsx',
      'src/data/**/*.test.ts',
      'src/data/**/*.test.tsx',
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
      // Ratcheted up per sprint — see docs/coverage-plan.md
      // Tier-1 target: 55/45/50/55
      thresholds: {
        statements: 55,
        branches: 45,
        functions: 50,
        lines: 55,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
