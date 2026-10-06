/**
 * @vitest-environment node
 *
 * `spawnforge/no-wait-for-function-options-as-arg` — Playwright's signature is
 * `waitForFunction(pageFunction, arg?, options?)`, so
 * `waitForFunction(fn, { timeout: 90_000 })` passes the object to the page
 * function and the wait silently uses `use.actionTimeout` (10s) instead.
 *
 * Three layers, because each one alone proves less than it reads:
 *  1. RuleTester — what the rule reports and how it fixes, shape by shape.
 *  2. The SHIPPED flat config switches the rule on (severity, not presence) for
 *     every e2e file that calls `waitForFunction`.
 *  3. A sweep of every `e2e/**` TS file with the rule alone finds no violation,
 *     and a vacuity guard proves the sweep actually parsed the calls it claims
 *     to have checked.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint, Linter, RuleTester, type Rule } from 'eslint';
import tsParser from '@typescript-eslint/parser';
import { describe, expect, it } from 'vitest';

import rule from '../../../eslint-rules/no-wait-for-function-options-as-arg.mjs';

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const E2E_ROOT = path.join(WEB_ROOT, 'e2e');
const RULE_ID = 'spawnforge/no-wait-for-function-options-as-arg';

RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester({
  languageOptions: { parser: tsParser, ecmaVersion: 2022, sourceType: 'module' },
});

const errors = [{ messageId: 'optionsAsArg' }];

ruleTester.run('no-wait-for-function-options-as-arg', rule as unknown as Rule.RuleModule, {
  valid: [
    // Options in the third slot — the fixed shape.
    'page.waitForFunction(() => ready(), undefined, { timeout: 90_000 });',
    'page.waitForFunction(() => ready(), null, { timeout: 90_000 });',
    // A real argument followed by options.
    'page.waitForFunction((n) => count() >= n, 3, { timeout: 10_000 });',
    // A real object argument with no options-named key.
    'page.waitForFunction(({ id }) => has(id), { id: "a" });',
    // No options at all.
    'page.waitForFunction(() => ready());',
    // An identifier in the second slot: arg or options is a type question, out of scope.
    'page.waitForFunction(() => ready(), opts);',
    // A computed key is not the option name.
    'page.waitForFunction(() => ready(), { [timeout]: 1 });',
    // Other methods with the same argument shape are untouched.
    'page.waitForSelector("#x", { timeout: 5_000 });',
    'page.evaluate(() => ready(), { timeout: 5_000 });',
    // Computed member access is not matched by name.
    'page["waitForFunction"](() => ready(), { timeout: 5_000 });',
    // A page function that READS its argument: the object is data, not options.
    // Reporting it would be wrong, and the autofix would hand the predicate
    // `undefined` (Devin review on #10335).
    'page.waitForFunction(({ timeout }) => elapsed() > timeout, { timeout: 100 });',
    'page.waitForFunction((t) => ready(t), { timeout: 1 });',
    'page.waitForFunction((...args) => ready(args), { timeout: 1 });',
    'page.waitForFunction(function (o) { return o.polling; }, { polling: 1 });',
    // A parameterless `function` that reads `arguments` still consumes the arg.
    'page.waitForFunction(function () { return arguments[0].timeout > 0; }, { timeout: 1 });',
    // A page function passed by reference: its parameters are not visible here.
    'page.waitForFunction(isReady, { timeout: 1 });',
  ],
  invalid: [
    {
      // The reported bug: editor.fixture.ts loadPage().
      code: 'await this.page.waitForFunction(() => window.__REACT_HYDRATED === true, { timeout: E2E_TIMEOUT_ENGINE_FULL_MS });',
      output: 'await this.page.waitForFunction(() => window.__REACT_HYDRATED === true, undefined, { timeout: E2E_TIMEOUT_ENGINE_FULL_MS });',
      errors,
    },
    {
      // Shorthand property, as in waitForEditorStore().
      code: 'page.waitForFunction(() => !!window.__EDITOR_STORE, { timeout });',
      output: 'page.waitForFunction(() => !!window.__EDITOR_STORE, undefined, { timeout });',
      errors,
    },
    {
      // `polling` is the other WaitForFunctionOptions key.
      code: 'page.waitForFunction(() => ready(), { polling: 100 });',
      output: 'page.waitForFunction(() => ready(), undefined, { polling: 100 });',
      errors,
    },
    {
      // String-literal key.
      code: 'page.waitForFunction(() => ready(), { "timeout": 1 });',
      output: 'page.waitForFunction(() => ready(), undefined, { "timeout": 1 });',
      errors,
    },
    {
      // Wrapped in `as const` / `satisfies` — still an object literal.
      code: 'page.waitForFunction(() => ready(), { timeout: 1 } as const);',
      output: 'page.waitForFunction(() => ready(), undefined, { timeout: 1 } as const);',
      errors,
    },
    {
      code: 'page.waitForFunction(() => ready(), { timeout: 1 } satisfies Opts);',
      output: 'page.waitForFunction(() => ready(), undefined, { timeout: 1 } satisfies Opts);',
      errors,
    },
    {
      // Frame and other receivers share the signature.
      code: 'frame.waitForFunction("window.ready", { timeout: 1, polling: "raf" });',
      output: 'frame.waitForFunction("window.ready", undefined, { timeout: 1, polling: "raf" });',
      errors,
    },
    {
      // A parameterless `function` expression that never touches `arguments`.
      code: 'page.waitForFunction(function () { return ready(); }, { timeout: 1 });',
      output: 'page.waitForFunction(function () { return ready(); }, undefined, { timeout: 1 });',
      errors,
    },
    {
      // A template-literal page function is an expression string; no arg.
      code: 'page.waitForFunction(`window.ready`, { timeout: 1 });',
      output: 'page.waitForFunction(`window.ready`, undefined, { timeout: 1 });',
      errors,
    },
    {
      // Optional call / chain.
      code: 'page?.waitForFunction(() => ready(), { timeout: 1 });',
      output: 'page?.waitForFunction(() => ready(), undefined, { timeout: 1 });',
      errors,
    },
    {
      // Bare destructured function.
      code: 'waitForFunction(() => ready(), { timeout: 1 });',
      output: 'waitForFunction(() => ready(), undefined, { timeout: 1 });',
      errors,
    },
  ],
});

function walkTs(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules') continue;
      walkTs(full, out);
    } else if (/\.(?:ts|tsx|mts|cts)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const rel = (file: string) => path.relative(WEB_ROOT, file).split(path.sep).join('/');

const e2eFiles = walkTs(E2E_ROOT);
// Files that call waitForFunction, judged from the text. `__tests__/` holds
// vitest unit suites, not Playwright callers — this file names the method
// dozens of times inside RuleTester strings, which the text match would count
// as calls the parser never sees. Those files are still swept for violations.
const callers = e2eFiles.filter((f) =>
  !f.split(path.sep).includes('__tests__')
  && /\bwaitForFunction\s*\(/.test(readFileSync(f, 'utf8')));

describe('shipped config', () => {
  it('finds e2e files that call waitForFunction at all', () => {
    // A coverage check over zero files passes vacuously (lessons-learned #9).
    expect(callers.length).toBeGreaterThan(0);
    expect(callers.map(rel)).toContain('e2e/fixtures/editor.fixture.ts');
  });

  /**
   * Severity, not presence: `calculateConfigForFile` normalises an `off`
   * override to `[0]`, which is truthy (see noRawResponseInCatchCoverage.test.ts).
   */
  async function severityFor(eslint: ESLint, file: string): Promise<unknown> {
    const config = (await eslint.calculateConfigForFile(file)) as { rules?: Record<string, unknown> };
    const entry = config.rules?.[RULE_ID];
    return Array.isArray(entry) ? entry[0] : entry;
  }

  it('switches the rule on at error for every e2e file that calls waitForFunction', async () => {
    const eslint = new ESLint({ cwd: WEB_ROOT });
    const off: string[] = [];
    for (const file of callers) {
      if ((await severityFor(eslint, file)) !== 2) off.push(rel(file));
    }
    expect(off, `${RULE_ID} is not at "error" for these files in web/eslint.config.mjs`).toEqual([]);
  }, 120_000);

  it('detects an override that switches it off — the negative control', async () => {
    const target = path.join(E2E_ROOT, 'fixtures/editor.fixture.ts');
    const disabled = new ESLint({
      cwd: WEB_ROOT,
      overrideConfig: [{ files: [rel(target)], rules: { [RULE_ID]: 'off' } }],
    });
    expect(await severityFor(disabled, target)).toBe(0);
  }, 60_000);
});

describe('e2e sweep', () => {
  // The rule plus a counter, run alone so the result does not depend on the
  // rest of the config (or on inline disables naming rules not loaded here).
  const seen = new Map<string, number>();
  const counter: Rule.RuleModule = {
    meta: { type: 'problem', schema: [] },
    create(context) {
      return {
        CallExpression(node) {
          const callee = node.callee;
          const name = callee.type === 'Identifier'
            ? callee.name
            : callee.type === 'MemberExpression' && callee.property.type === 'Identifier'
              ? callee.property.name
              : null;
          if (name === 'waitForFunction') {
            seen.set(context.filename, (seen.get(context.filename) ?? 0) + 1);
          }
        },
      };
    },
  };
  const config: Linter.Config[] = [{
    files: ['**/*.{ts,tsx,mts,cts}'],
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    languageOptions: { parser: tsParser as Linter.Parser, ecmaVersion: 2022, sourceType: 'module' },
    plugins: { local: { rules: { target: rule as unknown as Rule.RuleModule, counter } } },
    rules: { 'local/target': 'error', 'local/counter': 'error' },
  }];
  const linter = new Linter({ configType: 'flat' });
  const results = e2eFiles.map((file) => ({
    file: rel(file),
    messages: linter.verify(readFileSync(file, 'utf8'), config, file),
  }));

  it('parses every e2e file', () => {
    const fatal = results.flatMap(({ file, messages }) =>
      messages.filter((m) => m.fatal).map((m) => `${file}:${m.line} ${m.message}`));
    expect(fatal).toEqual([]);
  });

  it('visited a waitForFunction call in every file whose text contains one', () => {
    // Derived from the source, not a restated count (lessons-learned #18): if
    // the parser or the callee match stops seeing calls, this goes red.
    const unvisited = callers.filter((f) => !seen.has(f)).map(rel);
    expect(unvisited).toEqual([]);
    const outsideTests = [...seen.keys()].filter((f) => !f.split(path.sep).includes('__tests__'));
    expect(outsideTests.length).toBe(callers.length);
  });

  it('finds no waitForFunction(fn, { timeout }) in e2e/', () => {
    const violations = results.flatMap(({ file, messages }) =>
      messages.filter((m) => m.ruleId === 'local/target').map((m) => `${file}:${m.line}:${m.column}`));
    expect(violations, 'Options go third: waitForFunction(fn, undefined, { timeout })').toEqual([]);
  });
});
