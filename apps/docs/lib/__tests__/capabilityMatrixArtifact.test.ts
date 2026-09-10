/**
 * @vitest-environment node
 *
 * The capability-matrix loader against the REAL `data/capability-matrix.json`
 * — no mocked `fs`, no fixture document.
 *
 * WHY THIS FILE EXISTS
 *
 * `capabilityMatrix.test.ts` pins the parser on synthetic input. That is the
 * right tool for logic and the wrong tool for the artifact: the first loader
 * read `data/capability-matrix.md` with `fs.readFileSync` from a
 * `__dirname`-derived path at request time, its test read the same file from
 * disk and passed on every machine that had it, and nothing could observe that
 * Next.js output file tracing would never ship the file to `/var/task` — the
 * exact mechanism that 500'd `/mcp` in production for weeks (#9718;
 * lessons-learned #1 and #14).
 *
 * The loader now owns the copy through a static JSON import, so the bundler
 * traces it into the function like any other module. This suite pins BOTH
 * halves of that fix:
 *
 *   1. the module really loads the real copy and yields the real document —
 *      and that copy is the canonical `docs/capability-matrix.md`, line for
 *      line; and
 *   2. the module loads it in the way that survives output file tracing.
 *
 * (2) is a source-shape assertion, and it is the one that fails first. Nothing
 * short of a Vercel deploy can observe tracing at runtime, so the shape that
 * tracing depends on is pinned here and the deploy is verified by
 * `scripts/post-deploy-capability-matrix-check.sh`.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  hasMatrixRows,
  readCapabilityMatrix,
  shippedCapabilityMatrixMarkdown,
  statusOf,
} from '../capabilityMatrix';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LOADER_SOURCE = path.resolve(HERE, '../capabilityMatrix.ts');
const COPY_ON_DISK = path.resolve(HERE, '../../data/capability-matrix.json');
const CANONICAL_ON_DISK = path.resolve(HERE, '../../../../docs/capability-matrix.md');

// A row the matrix has carried since it was first published, and the marker
// the deploy smoke test looks for on the live page. If it is ever renamed,
// update this AND the default in scripts/post-deploy-capability-matrix-check.sh
// in the same PR.
const KNOWN_ROW = '`commands:scene`';

describe('the loader against the real data/capability-matrix.json', () => {
  it('the in-root copy exists where the loader imports it from', () => {
    expect(fs.existsSync(COPY_ON_DISK)).toBe(true);
  });

  it('reproduces the canonical docs/capability-matrix.md line for line', () => {
    // The web gate and the docs gate pin this too; this is the loader-side
    // view — what the PAGE will render is what the repo file says.
    const canonical = fs.readFileSync(CANONICAL_ON_DISK, 'utf-8');
    expect(canonical.length).toBeGreaterThan(0);
    expect(shippedCapabilityMatrixMarkdown()).toBe(canonical);
  });

  it('yields the real document with both matrix tables (not a vacuous walk)', () => {
    const doc = readCapabilityMatrix();
    expect(doc.title).toBe('Capability Matrix');
    expect(hasMatrixRows(doc)).toBe(true);

    const tables = doc.blocks.filter((b) => b.type === 'table');
    const matrixRows = tables.flatMap((t) => (t.type === 'table' ? t.rows : []));
    const generationRows = matrixRows.filter((r) => r[0]?.startsWith('`generation:'));
    const commandRows = matrixRows.filter((r) => r[0]?.startsWith('`commands:'));

    // The web gate pins the exact row set against providers.ts and the manifest;
    // this only asserts the copy this app ships is the real document.
    expect(generationRows.length).toBeGreaterThanOrEqual(10);
    expect(commandRows.length).toBeGreaterThanOrEqual(41);
    expect(matrixRows.map((r) => r[0])).toContain(KNOWN_ROW);
    for (const row of [...generationRows, ...commandRows]) {
      for (const cell of row.slice(1, 5)) {
        expect(statusOf(cell), `${row[0]}: "${cell}"`).not.toBeNull();
      }
    }
  });
});

describe('the loader depends on the copy in a way output file tracing can see', () => {
  const source = fs.readFileSync(LOADER_SOURCE, 'utf-8');
  // The negative assertions below are about CODE. The loader's own doc comment
  // legitimately names the loader that preceded it (and what it called), so
  // scan with comments stripped — a prose mention must not fail the pin, and
  // a call hidden behind one must not pass it. The loader has no string
  // literal containing `/*` or `//` (the issue URL is the one `//` in a
  // literal, and it is on a line that carries no comment marker before it, so
  // the line-comment strip cannot eat it — asserted below); the positive
  // assertion is made on the FULL source and would still hold if that changed.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

  it('the comment strip left executable code behind (the checks below scan something)', () => {
    expect(code).toMatch(/export function /);
    expect(code).toContain('ISSUE_BASE_URL');
  });

  it('imports data/capability-matrix.json statically', () => {
    // A static import is a module edge; Next.js bundles it into the server
    // function. A path built at runtime is invisible to tracing (#9718).
    expect(source).toMatch(/^import\s+\w+\s+from\s+'\.\.\/data\/capability-matrix\.json';?$/m);
  });

  it('does not read the matrix from the filesystem at runtime', () => {
    expect(code).not.toMatch(/readFileSync|readFile\(|createReadStream/);
    expect(code).not.toMatch(/from\s+['"](node:)?fs['"]/);
    expect(code).not.toMatch(/from\s+['"](node:)?path['"]/);
    expect(code).not.toMatch(/CAPABILITY_MATRIX_PATH|process\.env/);
    expect(code).not.toMatch(/import\.meta\.url|__dirname/);
  });
});
