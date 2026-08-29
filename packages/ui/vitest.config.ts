import { defineConfig } from 'vitest/config';

// This suite runs per-PR in ci.yml's design-internal-gate (PF-1003), which
// invokes `npm test` (→ `vitest run`) with no `--coverage` flag. `coverage.enabled`
// is therefore set below: a threshold checked only behind a flag nobody passes
// is not a gate.
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    coverage: {
      enabled: true,
      provider: 'v8',
      reporter: ['text-summary'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/**/__tests__/**',
        'src/**/*.d.ts',
        'src/test-setup.ts',
        // Barrel files — re-exports only, no logic.
        'src/index.ts',
        'src/internal.ts',
      ],
      // Baseline measured 2026-08-29 on Node 24 (PF-9453). Set at/just below
      // measured, same convention as web/vitest.config.ts: raise these only
      // when a real coverage gain has been made.
      thresholds: {
        statements: 83, // measured 84.17
        branches: 74, // measured 75.45
        functions: 82, // measured 83.24
        lines: 84, // measured 85.20
      },
    },
  },
});
