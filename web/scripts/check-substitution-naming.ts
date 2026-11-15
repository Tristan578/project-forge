/**
 * Substitution-naming gate for the Playwright specs (#10158).
 *
 *   npx tsx scripts/check-substitution-naming.ts [--config <playwright config>]
 *
 * Run from `web/`. Lists every spec with `playwright test --list
 * --reporter=json` — nothing runs, no browser or server is needed — and fails
 * when:
 *
 *   - a test declares a substitution (`{ type: 'substitution', description }`)
 *     but its full title lacks `[substituted: <component>]`, or carries the
 *     marker with no matching annotation (the rules in
 *     `e2e/lib/substitution.ts`);
 *   - the listing holds zero specs, reports a load error, or misses a
 *     `*.spec.ts` file that is on disk under `e2e/` — a listing that does not
 *     cover the tree proves nothing about the part it skipped;
 *   - the files the listing shows as substituted differ from the files whose
 *     source carries the literal declaration. `capabilityMatrix.test.ts` reads
 *     the literal form to keep substituted specs out of `proven` cells, so a
 *     declaration it cannot see (built from a constant) is refused here.
 *
 * Wired into the required `test-e2e-journey` job in `.github/workflows/ci.yml`
 * (pinned by `scripts/__tests__/production-ci-contract.test.mjs`). The summary
 * line names how many tests and spec files it listed, so the job log shows the
 * check ran over a non-empty tree.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  checkSubstitutionNaming,
  formatSubstitutionProblems,
  listSpecFiles,
  sourceDeclaresSubstitution,
  type Listing,
  type SubstitutionReport,
} from '../e2e/lib/substitution';

const PREFIX = '[substitution-naming]';
/** The listing of ~700 tests is ~600 KB of JSON; leave generous headroom. */
const MAX_LISTING_BYTES = 256 * 1024 * 1024;

export interface SubstitutionCheckOptions {
  /** Directory Playwright runs in; `config` resolves against it. */
  cwd: string;
  /** Playwright config file, relative to `cwd`. */
  config: string;
  /** Every `*.spec.ts` under this directory must appear in the listing. */
  specRoot: string;
}

export interface SubstitutionCheckOutcome {
  ok: boolean;
  /** Human-readable report, one line per entry. */
  lines: string[];
  report: SubstitutionReport | null;
}

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;
const toPosix = (path: string) => path.replace(/\\/g, '/');

/**
 * Run `playwright test --list --reporter=json` and parse what it printed.
 * Playwright exits non-zero for "No tests found" while still printing a report,
 * so the exit code alone decides nothing: a parseable report is always checked.
 */
export function readListing(cwd: string, config: string): { listing: Listing | null; diagnostic: string } {
  const cli = createRequire(import.meta.url).resolve('@playwright/test/cli');
  const env: NodeJS.ProcessEnv = { ...process.env, FORCE_COLOR: '0' };
  // Any of these would divert the JSON report away from stdout.
  for (const key of ['PLAYWRIGHT_JSON_OUTPUT_NAME', 'PLAYWRIGHT_JSON_OUTPUT_FILE', 'PLAYWRIGHT_JSON_OUTPUT_DIR']) {
    delete env[key];
  }
  const result = spawnSync(process.execPath, [cli, 'test', '--list', '--reporter=json', '--config', config], {
    cwd,
    env,
    encoding: 'utf8',
    maxBuffer: MAX_LISTING_BYTES,
  });
  const stderr = (result.stderr ?? '').trim();
  const detail = `exit ${result.status ?? result.signal ?? 'unknown'}${result.error ? `, ${result.error.message}` : ''}${
    stderr ? `, stderr: ${stderr.split('\n').slice(-5).join(' | ')}` : ''
  }`;
  try {
    return { listing: JSON.parse(result.stdout ?? '') as Listing, diagnostic: detail };
  } catch {
    return { listing: null, diagnostic: detail };
  }
}

export function runSubstitutionCheck(options: SubstitutionCheckOptions): SubstitutionCheckOutcome {
  const { listing, diagnostic } = readListing(options.cwd, options.config);
  if (listing === null) {
    return {
      ok: false,
      report: null,
      lines: [
        `${PREFIX} FAIL: could not read a listing from \`playwright test --list --reporter=json --config ${options.config}\` (${diagnostic})`,
      ],
    };
  }

  const report = checkSubstitutionNaming(listing);
  const extra: string[] = [];
  const rootDir = listing.config?.rootDir ?? options.cwd;
  const specRoot = resolve(options.specRoot);
  const display = (absolute: string) => toPosix(relative(specRoot, absolute));

  // Coverage: the listing must reach every spec file on disk, and nothing else.
  const onDisk = listSpecFiles(specRoot);
  const listed = new Set(report.specFiles.map((file) => resolve(rootDir, file)));
  if (onDisk.length === 0) {
    extra.push(`  ${toPosix(specRoot)}: no *.spec.ts files on disk — the spec root is wrong, so coverage cannot be checked`);
  }
  for (const file of onDisk) {
    if (!listed.has(file)) {
      extra.push(
        `  ${display(file)}: on disk but absent from the listing — it failed to load, or the config no longer matches it`,
      );
    }
  }
  const onDiskSet = new Set(onDisk);
  for (const file of listed) {
    if (!onDiskSet.has(file)) {
      extra.push(`  ${toPosix(file)}: listed but not under ${toPosix(specRoot)}, where the capability-matrix gate looks`);
    }
  }

  // Cross-check the literal declaration capabilityMatrix.test.ts scans for.
  const substitutedListed = new Set(report.substitutedFiles.map((file) => resolve(rootDir, file)));
  for (const file of onDisk) {
    const literal = sourceDeclaresSubstitution(readFileSync(file, 'utf8'));
    const annotated = substitutedListed.has(file);
    if (annotated && !literal) {
      extra.push(
        `  ${display(file)}: the listing shows a substitution annotation, but the source lacks the literal ` +
          `\`type: 'substitution'\` the capability-matrix gate scans for — write the annotation literally`,
      );
    } else if (literal && !annotated && listed.has(file)) {
      extra.push(
        `  ${display(file)}: the source carries a literal \`type: 'substitution'\` but the listing shows no ` +
          'substitution-annotated test — make it a real annotation or remove it',
      );
    }
  }

  const perFile = report.substitutedFiles
    .map((file) => `${file} (${report.substitutedTestsByFile[file]})`)
    .join(', ');

  const lines = [
    `${PREFIX} listed ${plural(report.testCount, 'test')} in ${plural(report.specFiles.length, 'spec file')} ` +
      `with ${options.config} (${plural(onDisk.length, '*.spec.ts file')} on disk under ${toPosix(relative(options.cwd, specRoot)) || '.'})`,
    `${PREFIX} ${plural(report.substitutedTestCount, 'test')} in ${plural(report.substitutedFiles.length, 'spec file')} ` +
      `declare a substitution${perFile ? `: ${perFile}` : ''}`,
  ];
  const problemCount = report.problems.length + extra.length;
  if (report.problems.length > 0) lines.push(formatSubstitutionProblems(report.problems));
  lines.push(...extra);
  lines.push(problemCount === 0 ? `${PREFIX} PASS` : `${PREFIX} FAIL: ${plural(problemCount, 'problem')}`);
  return { ok: problemCount === 0, lines, report };
}

// --- CLI -------------------------------------------------------------------
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const webDir = join(dirname(fileURLToPath(import.meta.url)), '..');
  const configFlag = process.argv.indexOf('--config');
  const config = configFlag >= 0 ? process.argv[configFlag + 1] : 'playwright.config.ts';
  if (!config) {
    console.error(`${PREFIX} --config needs a value`);
    process.exitCode = 1;
  } else {
    const outcome = runSubstitutionCheck({ cwd: webDir, config, specRoot: join(webDir, 'e2e') });
    for (const line of outcome.lines) (outcome.ok ? console.log : console.error)(line);
    if (!outcome.ok) process.exitCode = 1;
  }
}
