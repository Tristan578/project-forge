/**
 * Compare two downloaded performance reports (#9904, operation
 * performance.FR-3.OP-01) with the same rule the profiler and the AI use.
 *
 *   npx tsx scripts/compare-perf-reports.ts <current.json> <baseline.json>
 *
 * Prints the comparison as JSON. Exits 2 when either file is not a valid
 * report, so a typo'd path cannot read as "compatible".
 */
import { readFileSync } from 'node:fs';
import { compareReports, parsePerformanceReport } from '../src/lib/perf/performanceReport';

function load(file: string) {
  const parsed = parsePerformanceReport(JSON.parse(readFileSync(file, 'utf8')));
  if (!parsed.ok) {
    console.error(`${file} is not a valid performance report: ${parsed.error}`);
    process.exit(2);
  }
  return parsed.report;
}

const [currentFile, baselineFile] = process.argv.slice(2);
if (!currentFile || !baselineFile) {
  console.error('usage: tsx scripts/compare-perf-reports.ts <current.json> <baseline.json>');
  process.exit(2);
}
console.log(JSON.stringify(compareReports(load(currentFile), load(baselineFile)), null, 2));
