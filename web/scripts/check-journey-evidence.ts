/**
 * Post-run journey evidence check (#10157).
 *
 *   npx tsx scripts/check-journey-evidence.ts <dir> \
 *     [--min-journeys N] [--expect-github-sha SHA] [--expect-pr-head-sha SHA|'']
 *
 * Runs after the Playwright step of test-e2e-engine-smoke, over the directory
 * `e2e/lib/journeyEvidenceReporter.ts` wrote. Exit 0 when there is exactly one
 * valid record per journey-tagged test (and at least `--min-journeys`), 1 when
 * the evidence is missing or wrong, 2 on a usage error. The rules and their
 * reasons are in `e2e/lib/journeyEvidenceCheck.ts`.
 *
 * `--expect-pr-head-sha ''` means "this run has no PR head" (push, dispatch):
 * GitHub expands `github.event.pull_request.head.sha` to '' off a PR, so a
 * record that nevertheless carries one is flagged. Omitting the flag skips
 * the PR-head rule entirely.
 */
import { pathToFileURL } from 'node:url';
import {
  checkJourneyEvidence,
  type JourneyEvidenceCheckOptions,
} from '../e2e/lib/journeyEvidenceCheck';
import { normalizeSha } from '../e2e/lib/journeyEvidence';

const USAGE =
  'usage: check-journey-evidence <dir> [--min-journeys N] [--expect-github-sha SHA] [--expect-pr-head-sha SHA|""]';

export function parseCheckArgs(argv: readonly string[]): JourneyEvidenceCheckOptions {
  const options: Partial<JourneyEvidenceCheckOptions> = {};
  let dir: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      if (dir !== undefined) throw new Error(`unexpected argument ${arg}; ${USAGE}`);
      dir = arg;
      continue;
    }
    const eq = arg.indexOf('=');
    const flag = eq === -1 ? arg : arg.slice(0, eq);
    const value = (): string => {
      if (eq !== -1) return arg.slice(eq + 1);
      if (i + 1 >= argv.length) throw new Error(`${flag} needs a value; ${USAGE}`);
      i += 1;
      return argv[i];
    };
    switch (flag) {
      case '--min-journeys': {
        const n = Number(value());
        if (!Number.isInteger(n) || n < 1) throw new Error('--min-journeys must be a positive integer');
        options.minJourneys = n;
        break;
      }
      case '--expect-github-sha': {
        const sha = normalizeSha(value());
        if (sha === null) throw new Error('--expect-github-sha needs a SHA (pass the run\'s GITHUB_SHA)');
        options.expectGithubSha = sha;
        break;
      }
      case '--expect-pr-head-sha':
        options.expectPrHeadSha = normalizeSha(value());
        break;
      default:
        throw new Error(`unknown option ${flag}; ${USAGE}`);
    }
  }
  if (dir === undefined) throw new Error(USAGE);
  return { dir, ...options };
}

export interface CliResult {
  exitCode: number;
  lines: string[];
}

export function runCheckJourneyEvidence(
  argv: readonly string[],
  env: { GITHUB_ACTIONS?: string },
): CliResult {
  let options: JourneyEvidenceCheckOptions;
  try {
    options = parseCheckArgs(argv);
  } catch (error) {
    return { exitCode: 2, lines: [error instanceof Error ? error.message : String(error)] };
  }

  const result = checkJourneyEvidence(options);
  const lines = [`journey-evidence: ${result.counts.total} journey-tagged test(s) in ${options.dir}`];
  for (const j of result.journeys) {
    lines.push(`  ${j.outcome.padEnd(8)} ${j.journeyId.padEnd(24)} ${j.title}  (${j.evidence})`);
  }
  const c = result.counts;
  lines.push(`proven ${c.proven} | pass ${c.pass} | flaky ${c.flaky} | fail ${c.fail} | not-run ${c.notRun}`);

  const inActions = env.GITHUB_ACTIONS === 'true';
  for (const problem of result.problems) {
    lines.push(inActions ? `::error title=journey evidence::${problem}` : `ERROR: ${problem}`);
  }
  if (result.problems.length > 0) {
    lines.push(`journey-evidence check FAILED: ${result.problems.length} problem(s)`);
    return { exitCode: 1, lines };
  }
  lines.push('journey-evidence check passed');
  return { exitCode: 0, lines };
}

// --- CLI -------------------------------------------------------------------
// The `import.meta.url === argv[1]` guard lets the suite import this module
// without running it. No top-level await: tsx compiles web/ scripts as CJS
// (web/package.json has no "type": "module"), where TLA is a transform error.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { exitCode, lines } = runCheckJourneyEvidence(process.argv.slice(2), process.env);
  // stdout throughout: GitHub parses `::error::` workflow commands from it.
  for (const line of lines) console.log(line);
  process.exitCode = exitCode;
}
