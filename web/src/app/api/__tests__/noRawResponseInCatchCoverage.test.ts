/**
 * @vitest-environment node
 *
 * Does the catch-egress gate actually COVER the files that build API responses?
 *
 * The rule itself is pinned by `noRawResponseInCatch.test.ts`. That suite runs
 * the rule against source it writes, so it proves the rule works and proves
 * nothing about which files it is pointed at. The gate's first glob was
 * `src/app/api/**` + `route.ts`, which asserts "no route FILE leaks" rather
 * than "no API response leaks" — a check adjacent to the property that matters
 * (lessons-learned #1). Nothing failed when a response builder landed outside
 * it; five did.
 *
 * So this test asks the real question, of the real config: for every file in
 * the tree that CONSTRUCTS a response, is `spawnforge/no-raw-response-in-catch`
 * switched on? It resolves the answer through ESLint's own
 * `calculateConfigForFile`, not by re-implementing glob matching — a test that
 * matched the glob strings itself could agree with a config that ESLint reads
 * differently.
 *
 * The scan is what makes it self-maintaining: a new response-building module
 * fails this test on the day it is created, and the author either adds it to
 * the glob in `web/eslint.config.mjs` or adds it to EXCUSED below with a
 * reason. Both are deliberate acts; neither is silence.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const SRC = path.join(WEB_ROOT, 'src');
const RULE_ID = 'spawnforge/no-raw-response-in-catch';

/** Anything that turns into bytes on the wire for a client. */
const CONSTRUCTS_RESPONSE = /\b(?:NextResponse\s*\.\s*(?:json|redirect|rewrite|next|error)\s*\(|new\s+NextResponse\s*\(|new\s+Response\s*\(|Response\s*\.\s*(?:json|redirect|error)\s*\()/;

/**
 * Files that match the scan and are deliberately NOT gated. Every entry states
 * why, because an unexplained exclusion is how the previous glob's gap looked
 * from the outside.
 */
const EXCUSED = new Map<string, string>([
  [
    'src/lib/export/pwaGenerator.ts',
    'The `new Response(...)` is inside a template literal — source text for a '
    + 'generated service worker that runs in the exported game, not a server '
    + 'response this process ever constructs.',
  ],
  [
    'src/hooks/useEngine.ts',
    'Browser-side. It re-wraps a fetch RESPONSE it received in a progress-'
    + 'tracking stream; nothing is ever sent to a client from here, and there '
    + 'is no server error to leak.',
  ],
  [
    'src/test/utils/apiTestUtils.ts',
    'Test helper. `mockNextResponse` exists to satisfy the type checker in '
    + 'mock return values; it never runs in a request.',
  ],
  [
    'src/test/utils/streamingTestUtils.ts',
    'Test helper. Builds an SSE fixture for tests to read back.',
  ],
]);

function walkTs(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === '__tests__') continue;
      walkTs(full, out);
    } else if (/\.tsx?$/.test(entry) && !/\.(test|spec)\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function rel(file: string): string {
  return path.relative(WEB_ROOT, file).split(path.sep).join('/');
}

/**
 * Is the rule ON for this file — not merely PRESENT in its resolved config?
 *
 * The first version asked `if (!config.rules?.[RULE_ID])`, which is the property
 * adjacent to the one that matters (lessons-learned #1).
 * `calculateConfigForFile` returns the NORMALISED severity array: `[2]` for an
 * enabled rule and `[0]` for one an override switched off — and `[0]` is
 * TRUTHY. So a future override block in `web/eslint.config.mjs` disabling
 * `spawnforge/no-raw-response-in-catch` for any directory would leave this test
 * green while reporting those files as covered, which is exactly the failure
 * this file's own docblock claims to close. Read the severity.
 */
function ruleIsOn(config: { rules?: Record<string, unknown> }): boolean {
  const entry = config.rules?.[RULE_ID];
  const severity = Array.isArray(entry) ? entry[0] : entry;
  return severity === 2 || severity === 'error';
}

async function uncoveredIn(eslint: ESLint, files: string[]): Promise<string[]> {
  const uncovered: string[] = [];
  for (const file of files) {
    const relative = rel(file);
    if (EXCUSED.has(relative)) continue;
    // Sequential on purpose: ESLint caches config resolution, so parallelising
    // buys nothing and obscures which file failed.
    const config = (await eslint.calculateConfigForFile(file)) as {
      rules?: Record<string, unknown>;
    };
    if (!ruleIsOn(config)) uncovered.push(relative);
  }
  return uncovered;
}

describe('no-raw-response-in-catch coverage', () => {
  const responseBuilders = walkTs(SRC).filter((f) => CONSTRUCTS_RESPONSE.test(readFileSync(f, 'utf8')));

  it('finds response builders to check at all', () => {
    // A scan that matches nothing passes vacuously and reads as coverage
    // (lessons-learned #9). If this ever trips, the regex has drifted from the
    // codebase, not the other way round.
    expect(responseBuilders.length).toBeGreaterThan(50);
  });

  it('has the rule switched on for every file that builds a response', async () => {
    const uncovered = await uncoveredIn(new ESLint({ cwd: WEB_ROOT }), responseBuilders);

    expect(uncovered, `${uncovered.length} response builder(s) are not covered by ${RULE_ID}. `
      + 'Add them to the rule\'s `files` in web/eslint.config.mjs, or to EXCUSED in this test '
      + 'with a reason.').toEqual([]);
  }, 120_000);

  it('REPORTS a file the config switches the rule OFF for — the negative control', async () => {
    // Without this the severity check above is itself unproven: a corrected
    // predicate that still cannot report anything is the same defect wearing a
    // different value. An `off` override is normalised to `[0]`, which the old
    // truthiness test accepted as coverage.
    const target = responseBuilders.find((f) => !EXCUSED.has(rel(f)));
    expect(target, 'no unexcused response builder to run the control against').toBeDefined();

    const disabled = new ESLint({
      cwd: WEB_ROOT,
      overrideConfig: [{ files: [rel(target as string)], rules: { [RULE_ID]: 'off' } }],
    });

    expect(await uncoveredIn(disabled, [target as string])).toEqual([rel(target as string)]);
    // ...and the same file is covered without the override, so the control is
    // measuring the override rather than a file that was never gated.
    expect(await uncoveredIn(new ESLint({ cwd: WEB_ROOT }), [target as string])).toEqual([]);
  }, 60_000);

  it('excuses nothing that has stopped matching the scan', () => {
    // An EXCUSED entry for a file that no longer builds a response (or no
    // longer exists) is dead weight that makes the list look larger than the
    // gap it describes.
    const scanned = new Set(responseBuilders.map(rel));
    const stale = [...EXCUSED.keys()].filter((f) => !scanned.has(f));
    expect(stale, 'EXCUSED entries no longer matched by the scan').toEqual([]);
  });
});
