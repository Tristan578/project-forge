import { defineConfig, configDefaults } from 'vitest/config';

// This suite runs per-PR in ci.yml's docs-internal-gate (`npx vitest run`).
// `coverage.enabled` is set below so the thresholds are enforced by that plain
// invocation — the gate does not pass `--coverage`, and a threshold that is
// only checked behind a flag nobody passes is not a gate.
export default defineConfig({
  test: {
    globals: true,
    // Default to node environment — component tests use
    // `// @vitest-environment jsdom` inline directives.
    // environmentMatchGlobs was removed in vitest 4.x.
    environment: 'node',
    // One broad pattern, not a per-directory enumeration. The previous four
    // globs were directory- AND extension-scoped, so a test at a conventional
    // path the list did not name (`app/__tests__/*.test.tsx`, any co-located
    // `foo.test.ts`, a new top-level directory) was silently never collected
    // and its author got a green run for a test that never executed (PF-9453).
    // `lib/__tests__/testCollection.test.ts` fails if this stops matching every
    // test file in the tree.
    include: ['**/*.{test,spec}.{ts,tsx}'],
    exclude: [
      ...configDefaults.exclude,
      '**/.next/**',
      // Playwright owns `e2e/` (package.json → `test:e2e`); vitest must not
      // try to run browser specs.
      'e2e/**',
    ],
    coverage: {
      enabled: true,
      provider: 'v8',
      reporter: ['text-summary'],
      include: [
        'app/**/*.{ts,tsx}',
        'components/**/*.{ts,tsx}',
        'lib/**/*.{ts,tsx}',
        'scripts/**/*.ts',
        'proxy.ts',
      ],
      exclude: [
        '**/*.{test,spec}.{ts,tsx}',
        '**/__tests__/**',
        '**/*.d.ts',
        // Server Components with no testable logic — mirrors the
        // layout/page exclusion in web/vitest.config.ts.
        'app/**/layout.tsx',
        'app/**/page.tsx',
      ],
      // Baseline measured 2026-08-29 on Node 24 (PF-9453). Set at/just below
      // measured, same convention as web/vitest.config.ts: raise these only
      // when a real coverage gain has been made.
      thresholds: {
        statements: 78, // measured 79.83
        branches: 69, // measured 70.70
        functions: 88, // measured 90.00
        lines: 79, // measured 80.40
      },
    },
  },
});
