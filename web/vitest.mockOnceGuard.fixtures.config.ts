/**
 * Config for the mock*Once guard's fixture run (#9542).
 *
 * The fixtures under src/lib/testing/__fixtures__/onceGuard are deliberately
 * NOT `*.test.ts`: one of them must FAIL (that is what proves the guard fires),
 * so they cannot be picked up by the regular suite. mockOnceGuard.test.ts
 * spawns a child `vitest run --config` on this file and grades the JSON report.
 * The setup file is the real one, so the child exercises the guard exactly as
 * every other test file does.
 */
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  test: {
    environment: 'node',
    include: ['src/lib/testing/__fixtures__/onceGuard/*.fixture.ts'],
    setupFiles: ['./vitest.setup.ts'],
    // One worker, no isolation surprises: the fixtures assert ORDER-dependent
    // behaviour (a leak in test A, consumption in test B).
    pool: 'forks',
    maxWorkers: 1,
    fileParallelism: false,
    sequence: { shuffle: false },
    coverage: { enabled: false },
  },
});
