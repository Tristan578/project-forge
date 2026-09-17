/** Validate only public result fields; never log the diagnostics document. */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const failure = 'Visual results are incomplete or unverified. Restore Chromatic allowance/settings, review snapshots, and rerun the failed job.';
export function validateVisualResults(context) {
  const build = context?.build;
  const count = value => Number.isSafeInteger(value) && value >= 0;
  if (context?.isPublishOnly === true || context?.skipSnapshots === true ||
      build?.features?.uiTests !== true || build?.wasLimited !== false ||
      build?.status !== 'PASSED' || typeof build?.completedAt !== 'string' ||
      !Number.isFinite(Date.parse(build.completedAt)) ||
      !count(build?.testCount) || build.testCount === 0 ||
      build?.changeCount !== 0 || build?.errorCount !== 0 ||
      build?.interactionTestFailuresCount !== 0) {
    throw new Error(failure);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    validateVisualResults(JSON.parse(readFileSync(process.argv[2], 'utf8')));
    console.log('Completed accepted visual results verified.');
  } catch {
    console.error(failure);
    process.exitCode = 1;
  }
}
