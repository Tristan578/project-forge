import { defineConfig } from 'vitest/config';

// This suite runs per-PR in quality-gates.yml's test-mcp job, which invokes
// `npx vitest run` with no `--coverage` flag. `coverage.enabled` is therefore
// set below: a threshold checked only behind a flag nobody passes is not a gate.
//
// Before PF-9453 this package had no vitest config at all, so it ran on
// vitest's defaults and enforced nothing.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    coverage: {
      enabled: true,
      provider: 'v8',
      reporter: ['text-summary'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.{test,spec}.ts', 'src/**/__tests__/**', 'src/**/*.d.ts'],
      // Baseline measured 2026-08-29 on Node 24 (PF-9453). These are LOW —
      // src/index.ts, src/resources/index.ts, src/docs/index.ts and
      // src/transport/websocket.ts have no tests at all and sit at 0%. The
      // threshold is pinned at what the package actually measures rather than
      // at an aspirational number that would fail today; raising it means
      // writing tests for those entry points, which is separate work.
      thresholds: {
        statements: 57, // measured 59.01
        branches: 61, // measured 63.32
        functions: 46, // measured 47.77
        lines: 56, // measured 57.79
      },
    },
  },
});
