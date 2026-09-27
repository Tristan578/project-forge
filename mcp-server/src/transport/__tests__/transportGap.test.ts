import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);

/**
 * Pins the exact SDK type gap #10278 documents in `http.ts`'s two
 * `as Transport` casts: `@modelcontextprotocol/sdk` 1.30.0 declares
 * `Transport.onclose?: () => void` (no `| undefined`) while
 * `StreamableHTTPServerTransport`'s own `onclose` accessor is typed
 * `(() => void) | undefined`, so passing one where the other is expected
 * fails under `exactOptionalPropertyTypes` without a cast.
 *
 * `test-fixtures/transportGapProbe.ts` is the *un-cast* version of both
 * `http.ts` call sites (excluded from the real build — `tsconfig.json`'s
 * `include` is `src/**\/*`, which this directory is outside of). Compiling
 * it standalone is the automated form of the issue's own "How to check a
 * new SDK version quickly" recipe.
 *
 * This test asserts the gap is STILL PRESENT. That is the useful direction:
 * once a future SDK release fixes it, this test starts failing — the
 * signal to go delete the two casts in `http.ts` and this fixture/test
 * pair, exactly as the issue's "Done when" describes. It is deliberately
 * not testing that the cast VERSION compiles (that's just the real
 * `tsc --noEmit` gate on `src/transport/http.ts` already covers).
 */
describe('mcp SDK Transport gap (#10278)', () => {
  it('still requires the `as Transport` cast in http.ts — remove both casts and this fixture once it does not', () => {
    const testDir = path.dirname(fileURLToPath(import.meta.url));
    const fixtureDir = path.resolve(testDir, '../../../test-fixtures');
    const fixtureTsconfig = path.join(fixtureDir, 'tsconfig.json');

    let output = '';
    let exitCode = 0;
    try {
      output = execFileSync(
        process.execPath,
        [require.resolve('typescript/bin/tsc'), '--noEmit', '-p', fixtureTsconfig],
        { cwd: fixtureDir, encoding: 'utf8' },
      );
    } catch (err) {
      const e = err as { status?: number; stdout?: string };
      exitCode = e.status ?? 1;
      output = e.stdout ?? '';
    }

    // A future-fixed SDK would exit 0 with no diagnostics — that is the
    // condition under which this assertion (and the cast in http.ts) should
    // be deleted, not "fixed" some other way.
    expect(exitCode).not.toBe(0);
    expect(output).toContain('TS2379');
    expect(output).toContain('onclose');
  });
});
