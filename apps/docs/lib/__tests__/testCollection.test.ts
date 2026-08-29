import { describe, it, expect } from 'vitest';
import { globSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vitestConfig from '../../vitest.config';

/**
 * Guard for PF-9453.
 *
 * `apps/docs/vitest.config.ts` used to enumerate four directory- AND
 * extension-scoped include globs. A test placed at a conventional path the
 * list did not happen to name — `app/__tests__/*.test.tsx`, a co-located
 * `foo.test.ts`, anything under a new top-level directory — was silently never
 * collected. The author saw a green run and believed a test was protecting
 * them when it had never executed. Nothing failed; the file simply did not
 * exist as far as vitest was concerned.
 *
 * This test resolves the config's own `include`/`exclude` patterns against the
 * real tree and fails if any test file on disk would not be collected. It is a
 * parity check, not a snapshot: widening the tree is free, narrowing the globs
 * back to an enumeration is not.
 */

const DOCS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Directories that hold no vitest suites; kept in step with the config's `exclude`. */
const NON_VITEST_DIRS = ['node_modules', '.next', 'e2e'];

function isIgnored(entry: string): boolean {
  return NON_VITEST_DIRS.some(
    (dir) => entry === dir || entry.startsWith(`${dir}/`) || entry.includes(`/${dir}/`),
  );
}

function globFrom(patterns: readonly string[]): string[] {
  return patterns.flatMap((pattern) =>
    globSync(pattern, { cwd: DOCS_ROOT, exclude: isIgnored }).map((p) => p.split(path.sep).join('/')),
  );
}

describe('apps/docs vitest collection', () => {
  const include = vitestConfig.test?.include;

  it('declares include patterns', () => {
    expect(include).toBeDefined();
    expect(include!.length).toBeGreaterThan(0);
  });

  it('collects every test file that exists in the tree', () => {
    // Every `*.test.ts(x)` / `*.spec.ts(x)` on disk, found without consulting
    // the config — this is the independent list the config is checked against.
    const onDisk = globFrom(['**/*.{test,spec}.{ts,tsx}']).sort();
    expect(onDisk.length).toBeGreaterThan(0);

    const collected = new Set(globFrom(include!));
    const missed = onDisk.filter((file) => !collected.has(file));

    expect(missed).toEqual([]);
  });

  it('keeps the include patterns directory-agnostic and extension-complete', () => {
    // The three properties the pre-PF-9453 enumeration violated, asserted as
    // properties rather than a literal string so a legitimate widening (adding
    // `.mts`, say) stays green while a re-narrowing to per-directory globs
    // fails. The on-disk parity check above cannot catch this on its own: a
    // path that is legal but unoccupied leaves no file to notice its absence.
    for (const pattern of include!) {
      expect(
        pattern.startsWith('**/'),
        `include pattern "${pattern}" is directory-scoped — a test outside that directory is silently never collected`,
      ).toBe(true);
    }

    const joined = include!.join(' ');
    expect(joined).toContain('ts');
    expect(joined).toContain('tsx');
  });
});
