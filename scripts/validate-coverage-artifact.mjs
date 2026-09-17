/** Validate identity and measurements before privileged coverage ratcheting. */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function validateCoverageArtifact(metadata, summary, expectedSha, expectedRunId) {
  if (!/^[a-f0-9]{40}$/.test(expectedSha) || !/^[1-9][0-9]*$/.test(expectedRunId)) {
    throw new Error('Invalid coverage producer identity');
  }
  if (metadata?.sha !== expectedSha || metadata?.run_id !== expectedRunId) {
    throw new Error('Coverage artifact identity does not match the successful producer');
  }
  for (const key of ['statements', 'branches', 'functions', 'lines']) {
    const metric = summary?.total?.[key];
    if (!metric || !Number.isFinite(metric.pct) || metric.pct < 0 || metric.pct > 100 ||
        !Number.isSafeInteger(metric.total) || metric.total < 0 ||
        !Number.isSafeInteger(metric.covered) || metric.covered < 0 || metric.covered > metric.total) {
      throw new Error('Coverage summary contains invalid measurements');
    }
    const calculated = metric.total === 0 ? 100 : Math.floor(metric.covered / metric.total * 10_000) / 100;
    if (Math.abs(metric.pct - calculated) > 0.011) {
      throw new Error('Coverage summary percentages disagree with covered totals');
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [metadataPath, summaryPath, sha, runId] = process.argv.slice(2);
    validateCoverageArtifact(JSON.parse(readFileSync(metadataPath, 'utf8')),
      JSON.parse(readFileSync(summaryPath, 'utf8')), sha, runId);
    console.log('Coverage artifact identity and measurements verified');
  } catch {
    console.error('Rejected invalid coverage artifact');
    process.exitCode = 1;
  }
}
