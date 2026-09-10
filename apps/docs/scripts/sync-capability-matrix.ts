/**
 * sync-capability-matrix.ts
 *
 * Regenerates (or, with `--check`, verifies) `apps/docs/data/capability-matrix.json`
 * from the canonical `docs/capability-matrix.md`.
 *
 * WHY A JSON COPY, NOT THE .md
 *
 * The docs site deploys with `rootDirectory: apps/docs`, so `docs/` at the repo
 * root does not exist on Vercel and the page has to ship its own copy. The
 * first copy was a `.md` read with `fs.readFileSync` from a `__dirname`-derived
 * path at request time — byte-for-byte the loader that 500'd `/mcp` in
 * production (#9718): Next.js output file tracing bundles only module edges,
 * and a path assembled at runtime is not one, so the file never reached
 * `/var/task` and the page rendered its "could not be read" notice. A JSON
 * module is an edge the bundler owns: `lib/capabilityMatrix.ts` imports it
 * statically, a missing file is a build failure, and
 * `lib/__tests__/capabilityMatrixArtifact.test.ts` pins that shape.
 *
 * `lines` (one array element per markdown line) rather than one string, so a
 * matrix edit is a one-line-per-line diff in review instead of a single
 * unreadable escaped blob.
 *
 * Usage (from anywhere; paths resolve relative to this file):
 *   npx tsx apps/docs/scripts/sync-capability-matrix.ts          # write
 *   npx tsx apps/docs/scripts/sync-capability-matrix.ts --check  # verify, exit 1 if stale
 *
 * Gates: `web/src/lib/config/__tests__/capabilityMatrix.test.ts` (web unit
 * gate) and `check-manifest-sync.ts` (docs gate) both fail on a stale copy.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

export const CANONICAL_MATRIX_PATH = path.join(repoRoot, 'docs/capability-matrix.md');
export const MATRIX_COPY_PATH = path.join(repoRoot, 'apps/docs/data/capability-matrix.json');

/** Repo-relative path recorded in the copy so a reader knows where to edit. */
export const MATRIX_SOURCE = 'docs/capability-matrix.md';

export interface CapabilityMatrixCopy {
  /** Where the content comes from — edit that file, not this one. */
  source: string;
  /** The markdown, one element per line. `lines.join('\n')` is the file. */
  lines: string[];
}

export interface MatrixSyncResult {
  passed: boolean;
  error?: string;
}

/** The copy that reproduces `markdown` exactly. */
export function toMatrixCopy(markdown: string): CapabilityMatrixCopy {
  return { source: MATRIX_SOURCE, lines: markdown.split('\n') };
}

/** The bytes to write for a copy — pretty-printed, trailing newline. */
export function renderMatrixCopy(copy: CapabilityMatrixCopy): string {
  return `${JSON.stringify(copy, null, 2)}\n`;
}

/**
 * Verify `copyJson` reproduces `markdown` line for line. Pure; the CLI and the
 * docs gate both go through this so the two cannot disagree about "in sync".
 */
export function checkMatrixCopy(markdown: string, copyJson: string): MatrixSyncResult {
  let copy: Partial<CapabilityMatrixCopy>;
  try {
    copy = JSON.parse(copyJson) as Partial<CapabilityMatrixCopy>;
  } catch {
    return { passed: false, error: 'capability-matrix.json is not valid JSON' };
  }
  if (!Array.isArray(copy.lines) || !copy.lines.every((l) => typeof l === 'string')) {
    return { passed: false, error: 'capability-matrix.json has no `lines` string array' };
  }
  if (copy.source !== MATRIX_SOURCE) {
    return { passed: false, error: `capability-matrix.json \`source\` must be "${MATRIX_SOURCE}"` };
  }
  if (copy.lines.join('\n') !== markdown) {
    return {
      passed: false,
      error: 'capability-matrix.json is out of sync with docs/capability-matrix.md — run `npm run sync:capability-matrix`',
    };
  }
  return { passed: true };
}

/** Read both files and compare. Missing or unreadable is a failure, never a pass. */
export function checkMatrixCopyOnDisk(
  canonicalPath: string = CANONICAL_MATRIX_PATH,
  copyPath: string = MATRIX_COPY_PATH,
): MatrixSyncResult {
  let markdown: string;
  let copyJson: string;
  try {
    markdown = fs.readFileSync(canonicalPath, 'utf-8');
  } catch {
    return { passed: false, error: `Cannot read canonical capability matrix: ${canonicalPath}` };
  }
  try {
    copyJson = fs.readFileSync(copyPath, 'utf-8');
  } catch {
    return { passed: false, error: `Cannot read capability matrix copy: ${copyPath}` };
  }
  return checkMatrixCopy(markdown, copyJson);
}

// ---- CLI wrapper (only runs when executed directly) ----

const isMainModule =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMainModule) {
  if (process.argv.includes('--check')) {
    const result = checkMatrixCopyOnDisk();
    if (!result.passed) {
      console.error(result.error);
      process.exit(1);
    }
    console.log(`Capability matrix copy is in sync (${path.relative(repoRoot, MATRIX_COPY_PATH)}).`);
  } else {
    const markdown = fs.readFileSync(CANONICAL_MATRIX_PATH, 'utf-8');
    fs.writeFileSync(MATRIX_COPY_PATH, renderMatrixCopy(toMatrixCopy(markdown)));
    console.log(`Wrote ${path.relative(repoRoot, MATRIX_COPY_PATH)} from ${MATRIX_SOURCE}.`);
  }
}
