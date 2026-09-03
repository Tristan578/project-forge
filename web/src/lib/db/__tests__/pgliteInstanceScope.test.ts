/**
 * Pins the one-PGlite-per-file rule that `.claude/rules/gotchas-build-ci.md`
 * states in prose.
 *
 * Repeated Postgres-WASM init/teardown inside a single vitest worker is the
 * shape behind the intermittent V8 CHECK failure in
 * `ThreadIsolation::UnregisterWasmAllocation` (SIGILL, exit 132) that failed
 * Web Tests closed on #9590 — see #9643, upstream electric-sql/pglite#1053 and
 * nodejs/node#64500. One instance per FILE (`beforeAll`) keeps the crash
 * surface at one boot; a `beforeEach` multiplies it by the test count.
 *
 * Until this file existed the rule was a sentence in a rules document with no
 * assertion behind it, so the next author to write a `beforeEach`-scoped
 * harness reintroduced the churn silently. A convention enforced only by prose
 * is not enforced.
 *
 * Two traps this scanner is deliberately shaped around:
 *
 * 1. **The population is NOT `*.db.test.ts`.** Three of the eight harness
 *    consumers (`chargeRefund`, `radarReview`, `reverseAddonTokens`, all under
 *    `lib/billing/__tests__/`) carry no `.db` suffix, and `pgliteHarness.test.ts`
 *    — the file that actually crashed — carries none either. A sweep globbing
 *    `*.db.test.ts` structurally skips the exemplar.
 *
 * 2. **`createTestHarness` is an ambiguous name.** `src/__integration__/harness.ts`
 *    exports its own `createTestHarness()`, a Zustand store harness that boots
 *    no WASM at all; five files call it from `beforeEach` across six call
 *    sites, correctly. Matching the bare identifier produces six false
 *    positives and would fail this suite on healthy code, so every match is
 *    keyed on the IMPORT SPECIFIER resolving
 *    to `lib/db/__tests__/pgliteHarness` (or a direct `new PGlite(`) instead.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stripComments } from '@/test/utils/importScanner';

/** `web/src` — the base every reported path is relative to. */
const SRC = join(__dirname, '..', '..', '..');

const SKIPPED_DIRS = new Set(['node_modules', '.next', 'dist', 'coverage']);

/** The module whose `createTestHarness` really boots Postgres-WASM. */
const HARNESS_MODULE = 'lib/db/__tests__/pgliteHarness';

/** The only hook a PGlite boot may sit in. */
const REQUIRED_HOOK = 'beforeAll';

const HOOK_NAMES = ['beforeAll', 'beforeEach', 'afterAll', 'afterEach'];

function collectTestFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIPPED_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectTestFiles(full));
    } else if (/\.test\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * True when `file` imports `createTestHarness` from the PGlite harness — by
 * specifier, never by bare name. Covers the `@/lib/db/__tests__/pgliteHarness`
 * alias and the `./pgliteHarness` relative form used from inside that folder.
 */
function importsPgliteHarness(file: string, lines: string[]): boolean {
  const source = lines.join('\n');
  const dir = relative(SRC, file).replace(/\\/g, '/');
  const inHarnessDir = dir.startsWith('lib/db/__tests__/');

  for (const statement of source.match(/import[\s\S]*?from\s*['"][^'"]+['"]/g) ?? []) {
    if (!/\bcreateTestHarness\b/.test(statement)) continue;
    // A type-only import boots nothing.
    if (/^import\s+type\b/.test(statement.trim())) continue;
    const specifier = statement.match(/from\s*['"]([^'"]+)['"]/)?.[1] ?? '';
    const normalized = specifier.replace(/^@\//, '');
    if (normalized === HARNESS_MODULE) return true;
    if (inHarnessDir && /^\.{1,2}\/pgliteHarness$/.test(specifier)) return true;
  }
  return false;
}

/**
 * The hook whose call actually OPENS the brace that follows `opener`, or `null`
 * when a non-hook callee (or nothing at all) opens it.
 *
 * Two wrong rules were tried before this one, and both fail OPEN — they name a
 * compliant hook for a boot that is not in one:
 *
 * - **List order.** `HOOK_NAMES.find(...)` credited
 *   `beforeAll(seed); afterEach(async () => {` to `beforeAll`, because that is
 *   what `HOOK_NAMES` lists first.
 * - **Textual proximity.** Taking the LAST hook name anywhere in `opener`
 *   credited `beforeAll(() => register(afterEach)); describe('x', () => {` to
 *   `afterEach` — a name that appears only as an ARGUMENT, inside a call that
 *   had already closed before the brace. The truthful answer is `null`
 *   (describe scope), so a per-file rule reports a pass on a boot that sits in
 *   no hook at all.
 *
 * Neither the order of the names nor their distance from the brace carries the
 * information; only whether a call is still OPEN there does. So this keeps a
 * paren stack (skipping quoted text, since a `(` inside a string literal is not
 * a call) and walks it innermost-outward, returning the first callee that is a
 * hook name. Walking outward rather than stopping at the innermost frame is
 * what keeps `beforeAll(() => wrap(() => {` resolving to `beforeAll`: the boot
 * really does run once, inside that hook.
 *
 * Pinned by the `enclosingHook` suite below, which carries a case for each of
 * the two wrong rules.
 */
function hookOpeningBrace(opener: string): string | null {
  const openParens: number[] = [];
  let quote: string | null = null;

  for (let i = 0; i < opener.length; i += 1) {
    const ch = opener[i];
    if (quote !== null) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch;
    else if (ch === '(') openParens.push(i);
    else if (ch === ')') openParens.pop();
  }

  for (let k = openParens.length - 1; k >= 0; k -= 1) {
    const callee = /([A-Za-z_$][\w$]*)\s*$/.exec(opener.slice(0, openParens[k]))?.[1];
    if (callee !== undefined && HOOK_NAMES.includes(callee)) return callee;
  }
  return null;
}

/**
 * The hook enclosing the call that starts at `column` on `lineIndex`, or `null`
 * at file/describe scope.
 *
 * Walks upward tracking brace balance: each `}` seen going up owes a `{`, so
 * the first `{` that drives the balance negative opens the block we are inside.
 * If that line names a hook, that is the answer; otherwise keep climbing, which
 * is what lets a call nested in an `if` inside a `beforeAll` still resolve to
 * `beforeAll`. Operates on comment-stripped lines, so a brace in a comment
 * cannot skew the count.
 *
 * `column` is load-bearing, not decorative. On the call's own line the scan must
 * start at the character BEFORE the call; starting at end-of-line counts the
 * hook's own trailing `}`, which then cancels its opening `{` so the balance
 * never goes negative and the hook is never named. That made every single-line
 * `beforeAll(async () => { harness = await createTestHarness(); });` resolve to
 * `null` — a false failure on fully compliant code. Pinned by the
 * `enclosingHook` suite below.
 */
export function enclosingHook(lines: string[], lineIndex: number, column: number): string | null {
  let balance = 0;
  for (let i = lineIndex; i >= 0; i -= 1) {
    const line = lines[i];
    const scanFrom = i === lineIndex ? column - 1 : line.length - 1;
    for (let c = scanFrom; c >= 0; c -= 1) {
      if (line[c] === '}') balance += 1;
      else if (line[c] === '{') {
        balance -= 1;
        if (balance < 0) {
          const opener = line.slice(0, c);
          const hook = hookOpeningBrace(opener);
          if (hook) return hook;
          balance = 0; // Keep climbing past a non-hook block.
        }
      }
    }
  }
  return null;
}

interface Boot {
  file: string;
  line: number;
  call: string;
  hook: string | null;
}

function findBoots(): { boots: Boot[]; scanned: number; consumers: Set<string> } {
  const boots: Boot[] = [];
  const consumers = new Set<string>();
  const files = collectTestFiles(SRC);

  for (const file of files) {
    // This file spells both call shapes out as plain string literals — in the
    // `call:` field below and in the `enclosingHook` fixtures at the bottom —
    // so it is a match for itself. (The two regexes above are NOT: after `new`
    // comes a backslash, not whitespace.) Same self-match the engine's
    // `component_carry_tests.rs` sibling-file split exists to dodge. Excluding
    // exactly one path (never a pattern) keeps that from widening into an
    // escape hatch.
    if (file === __filename) continue;
    const lines = stripComments(readFileSync(file, 'utf8'));
    const viaHarness = importsPgliteHarness(file, lines);

    lines.forEach((line, index) => {
      const direct = /\bnew\s+PGlite\s*\(/.exec(line);
      const factory = viaHarness ? /\bcreateTestHarness\s*\(/.exec(line) : null;
      const match = direct ?? factory;
      if (!match) return;
      consumers.add(file);
      boots.push({
        file: relative(SRC, file).replace(/\\/g, '/'),
        line: index + 1,
        call: direct ? 'new PGlite(' : 'createTestHarness(',
        hook: enclosingHook(lines, index, match.index),
      });
    });
  }

  return { boots, scanned: files.length, consumers };
}

describe('PGlite instances are scoped per file, not per test', () => {
  const { boots, scanned, consumers } = findBoots();

  // A scan that matches nothing reports zero problems and reads as coverage
  // (lessons-learned #11). These three assertions are what make every verdict
  // below a real one.
  it('scanned a non-empty population', () => {
    expect(scanned).toBeGreaterThan(0);
    expect(boots.length).toBeGreaterThan(0);
  });

  it('matches harness consumers that do NOT carry the .db.test.ts suffix', () => {
    // The whole point of the corrected rule: a `*.db.test.ts` glob misses these.
    const names = new Set([...consumers].map(f => basename(f)));
    for (const missed of ['chargeRefund.test.ts', 'radarReview.test.ts', 'reverseAddonTokens.test.ts']) {
      expect(names).toContain(missed);
    }
  });

  it('does not match the unrelated Zustand createTestHarness', () => {
    // `src/__integration__/harness.ts` exports a same-named factory that boots
    // no WASM; its callers use `beforeEach` correctly. Keying on the bare name
    // instead of the specifier would drag them in and fail on healthy code.
    const zustandHarness = join(SRC, '__integration__', 'harness.ts');
    expect(statSync(zustandHarness).isFile()).toBe(true);
    for (const file of consumers) {
      expect(relative(SRC, file).replace(/\\/g, '/')).not.toMatch(/^__integration__\//);
    }
  });

  it.each(
    // Enumerates the SAME `boots` the three guards above certified — a second
    // `findBoots()` call here would let the guards vouch for one array while
    // the cases ran over another, and would re-read every test file under
    // `web/src` a second time per run.
    // Named per boot so a failure reports the offending file, not just a count.
    boots.map(b => [`${b.file}:${b.line}`, b] as const),
  )('%s boots PGlite in beforeAll', (_label, boot) => {
    expect(boot.hook).toBe(REQUIRED_HOOK);
  });
});

describe('enclosingHook', () => {
  // The scanner is only as good as this function, and its failure direction is
  // a FALSE FAILURE on compliant code, which is the kind a reviewer talks the
  // author out of trusting. Each case below fails on the pre-fix version that
  // started its backward scan at end-of-line.
  const columnOf = (line: string) => line.indexOf('createTestHarness(');

  it('resolves a hook written entirely on one line', () => {
    const lines = ['  beforeAll(async () => { harness = await createTestHarness(); });'];
    expect(enclosingHook(lines, 0, columnOf(lines[0]))).toBe('beforeAll');
  });

  it('names the offending hook when a one-line boot is per-test', () => {
    // The verdict must differ by hook, not merely be non-null: a fix that
    // returned `beforeAll` unconditionally would pass the case above.
    const lines = ['  beforeEach(async () => { harness = await createTestHarness(); });'];
    expect(enclosingHook(lines, 0, columnOf(lines[0]))).toBe('beforeEach');
  });

  it('resolves a hook spanning several lines', () => {
    const lines = ['beforeAll(async () => {', '  harness = await createTestHarness();', '});'];
    expect(enclosingHook(lines, 1, columnOf(lines[1]))).toBe('beforeAll');
  });

  it('climbs past an intervening non-hook block', () => {
    const lines = [
      'beforeAll(async () => {',
      '  if (needed) {',
      '    harness = await createTestHarness();',
      '  }',
      '});',
    ];
    expect(enclosingHook(lines, 2, columnOf(lines[2]))).toBe('beforeAll');
  });

  it('returns null at describe scope', () => {
    const lines = ['describe("x", () => {', '  const harness = createTestHarness();', '});'];
    expect(enclosingHook(lines, 1, columnOf(lines[1]))).toBeNull();
  });

  it('credits the hook that actually opens the brace, not the first one listed', () => {
    // `beforeAll` is listed before `afterEach` in HOOK_NAMES, so a scan that
    // resolves by list order reports `beforeAll` here — a per-test boot wearing
    // a compliant hook's name.
    const lines = ['  beforeAll(seed); afterEach(async () => { harness = await createTestHarness(); });'];
    expect(enclosingHook(lines, 0, columnOf(lines[0]))).toBe('afterEach');
  });

  it('does not over-correct to the LAST hook name in the list', () => {
    // Guards the fix's other direction: this case already passed before the
    // fix, and fails on a naive "pick whichever name sorts last in HOOK_NAMES"
    // repair. Proximity is the rule, not list position in either direction.
    const lines = ['  afterEach(cleanup); beforeAll(async () => { harness = await createTestHarness(); });'];
    expect(enclosingHook(lines, 0, columnOf(lines[0]))).toBe('beforeAll');
  });

  it('ignores a hook name that is only an ARGUMENT to an already-closed call', () => {
    // The case that broke the proximity rule. `afterEach` is the last hook name
    // on the line, but its call closed before the brace — `describe` opens it,
    // so the boot is at describe scope and the honest answer is null. Reporting
    // `afterEach` here fails OPEN: a boot in no hook wears a hook's name and
    // the per-file rule reports a pass. Fails on the shipped version.
    const lines = [
      "  beforeAll(() => register(afterEach)); describe('x', () => { const h = createTestHarness(); });",
    ];
    expect(enclosingHook(lines, 0, columnOf(lines[0]))).toBeNull();
  });

  it('resolves through a non-hook call nested inside the hook', () => {
    // The reason the paren stack is walked outward instead of stopping at the
    // innermost frame: `wrap` opens the brace, but the boot still runs once per
    // file because `beforeAll` is the frame that is still open around it.
    const lines = ['  beforeAll(() => wrap(() => { harness = createTestHarness(); }));'];
    expect(enclosingHook(lines, 0, columnOf(lines[0]))).toBe('beforeAll');
  });

  it('does not read a paren inside a string literal as a call boundary', () => {
    // A shaped fixture, not a shape lifted from a real test file: it exists to
    // make the quote-skipping falsifiable, and the assertion is chosen because
    // it is the one that CAN fail. A `)` inside a string closes no call, but a
    // stack that does not skip quoted spans pops `beforeAll`'s frame on it,
    // reads the frame as already closed, and answers `null` — hiding a real
    // hook rather than inventing one. Most unbalanced-paren fixtures cannot
    // fail here at all, because walking the stack outward absorbs the error;
    // this one puts the stray `)` INSIDE the hook's own argument list, where it
    // removes the frame the answer depends on.
    const lines = ["  beforeAll(register(')'), async () => { harness = await createTestHarness(); });"];
    expect(enclosingHook(lines, 0, columnOf(lines[0]))).toBe('beforeAll');
  });
});
