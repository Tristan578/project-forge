/**
 * @vitest-environment node
 *
 * End-to-end cases for `scripts/check-substitution-naming.ts` (#10158): each
 * case writes synthetic spec files and a Playwright config into a temp
 * directory and runs the REAL `playwright test --list --reporter=json` over
 * them, so the suite proves what Playwright actually emits — in particular that
 * a describe-level annotation reaches every test inside it — rather than what a
 * hand-built listing assumes (lessons-learned #14). The pure rules are covered
 * case by case in `e2e/lib/__tests__/substitution.test.ts`.
 *
 * The temp directory sits outside the repository, so the synthetic specs import
 * `@playwright/test` by the absolute path the CLI itself loads — the same module
 * instance, which Playwright requires.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { runSubstitutionCheck } from '../check-substitution-naming';

const PLAYWRIGHT_TEST = createRequire(import.meta.url).resolve('@playwright/test');
const LISTING_TIMEOUT_MS = 120_000;

const root = mkdtempSync(join(tmpdir(), 'substitution-check-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

/** A temp Playwright project: a config plus spec files, each importing the CLI's own @playwright/test. */
function project(name: string, specs: Record<string, string>, testMatch = '**/*.spec.ts'): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'pw.config.ts'),
    `export default { testDir: '.', testMatch: ${JSON.stringify(testMatch)}, projects: [{ name: 'chromium' }] };\n`,
  );
  for (const [file, body] of Object.entries(specs)) {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), `import { test } from ${JSON.stringify(PLAYWRIGHT_TEST)};\n${body}\n`);
  }
  return dir;
}

function check(dir: string) {
  const outcome = runSubstitutionCheck({ cwd: dir, config: 'pw.config.ts', specRoot: dir });
  return { ...outcome, output: outcome.lines.join('\n') };
}

describe('check-substitution-naming against a real Playwright listing', () => {
  it(
    'passes honest specs, and counts a describe-level declaration on every test inside it',
    () => {
      const dir = project('honest', {
        'honest.spec.ts': [
          `test('drives the real editor', async () => {});`,
          `test.describe('Gate [substituted: AI generation] @journey', {`,
          `  annotation: { type: 'substitution', description: 'AI generation' },`,
          `}, () => {`,
          `  test('first', async () => {});`,
          `  test.describe('nested', () => {`,
          `    test('second', async () => {});`,
          `  });`,
          `});`,
          `test('plays [substituted: WASM engine]', {`,
          `  annotation: { type: 'substitution', description: 'WASM engine' },`,
          `}, async () => {});`,
        ].join('\n'),
      });
      const result = check(dir);
      expect(result.output).toContain('listed 4 tests in 1 spec file');
      expect(result.output).toContain('3 tests in 1 spec file declare a substitution');
      expect(result.output).toContain('honest.spec.ts (3)');
      expect(result.ok, result.output).toBe(true);
    },
    LISTING_TIMEOUT_MS,
  );

  it(
    'FAILS a synthetic spec with a substitution annotation and no title marker, naming the file and the test',
    () => {
      const dir = project('unmarked', {
        'tests/unmarked.spec.ts': [
          `test('AI builds a level', {`,
          `  annotation: { type: 'substitution', description: 'AI generation' },`,
          `}, async () => {});`,
        ].join('\n'),
      });
      const result = check(dir);
      expect(result.ok).toBe(false);
      // Line 2: the generated import is line 1.
      expect(result.output).toContain('tests/unmarked.spec.ts:2 › AI builds a level');
      expect(result.output).toContain('lacks [substituted: AI generation]');
      expect(result.output).toContain('FAIL');
    },
    LISTING_TIMEOUT_MS,
  );

  it(
    'FAILS every test under an annotated describe whose title lacks the marker',
    () => {
      const dir = project('describe-unmarked', {
        'journey.spec.ts': [
          `test.describe('Interactive Journey Gate @journey', {`,
          `  annotation: { type: 'substitution', description: 'AI generation' },`,
          `}, () => {`,
          `  test('first', async () => {});`,
          `  test('second', async () => {});`,
          `});`,
        ].join('\n'),
      });
      const result = check(dir);
      expect(result.ok).toBe(false);
      expect(result.output).toContain('Interactive Journey Gate @journey › first');
      expect(result.output).toContain('Interactive Journey Gate @journey › second');
    },
    LISTING_TIMEOUT_MS,
  );

  it(
    'FAILS a title that carries the marker without the annotation',
    () => {
      const dir = project('marker-only', {
        'marker-only.spec.ts': `test('pretends [substituted: WASM engine]', async () => {});`,
      });
      const result = check(dir);
      expect(result.ok).toBe(false);
      expect(result.output).toContain('carries [substituted: WASM engine] but no substitution annotation');
    },
    LISTING_TIMEOUT_MS,
  );

  it(
    'FAILS when the listing finds zero specs, for example because the config glob matches nothing',
    () => {
      const dir = project('zero', {}, '**/nothing-matches-*.spec.ts');
      const result = check(dir);
      expect(result.ok).toBe(false);
      expect(result.output).toMatch(/zero specs/);
    },
    LISTING_TIMEOUT_MS,
  );

  it(
    'FAILS when a spec file on disk is missing from the listing',
    () => {
      const dir = project(
        'partial-glob',
        {
          'listed.spec.ts': `test('listed', async () => {});`,
          'forgotten.spec.ts': `test('forgotten', async () => {});`,
        },
        '**/listed.spec.ts',
      );
      const result = check(dir);
      expect(result.ok).toBe(false);
      expect(result.output).toMatch(/forgotten\.spec\.ts.*absent from the listing/);
    },
    LISTING_TIMEOUT_MS,
  );

  it(
    'FAILS a declaration the listing sees but the capability-matrix source scan cannot',
    () => {
      const dir = project('dynamic', {
        'dynamic.spec.ts': [
          `const KIND = 'substitution';`,
          `test('plays [substituted: WASM engine]', {`,
          `  annotation: { type: KIND, description: 'WASM engine' },`,
          `}, async () => {});`,
        ].join('\n'),
      });
      const result = check(dir);
      expect(result.ok).toBe(false);
      expect(result.output).toMatch(/dynamic\.spec\.ts.*literal/);
    },
    LISTING_TIMEOUT_MS,
  );

  it(
    'FAILS a literal declaration that the listing does not show on any test',
    () => {
      const dir = project('stray-literal', {
        'stray.spec.ts': [
          `const notAnAnnotation = { type: 'substitution', description: 'AI generation' };`,
          `test('plain', async () => { void notAnAnnotation; });`,
        ].join('\n'),
      });
      const result = check(dir);
      expect(result.ok).toBe(false);
      expect(result.output).toMatch(/stray\.spec\.ts.*no substitution-annotated test/);
    },
    LISTING_TIMEOUT_MS,
  );

  it(
    'FAILS with the Playwright diagnostics when the config cannot be loaded at all',
    () => {
      const dir = project('no-config', {});
      const result = runSubstitutionCheck({ cwd: dir, config: 'missing.config.ts', specRoot: dir });
      expect(result.ok).toBe(false);
      expect(result.lines.join('\n')).toMatch(/could not read a listing/);
    },
    LISTING_TIMEOUT_MS,
  );
});
