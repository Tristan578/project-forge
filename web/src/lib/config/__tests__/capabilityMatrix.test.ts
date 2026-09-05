/**
 * @vitest-environment node
 *
 * `docs/capability-matrix.md` is the public statement of which capability works
 * through which entry point (#9720). It is prose, so nothing else in the tree
 * would notice it rotting: a new `PROVIDER_CAPABILITIES` entry or a new manifest
 * category would ship with no row, and a typo'd status would read as a sixth
 * state nobody defined. This suite makes the file a gate:
 *
 *   - every `PROVIDER_CAPABILITIES` entry has a `generation:<capability>` row;
 *   - every category in `mcp-server/manifest/commands.json` has a
 *     `commands:<category>` row;
 *   - no row names a capability or category that no longer exists (a stale row
 *     is the same lie in the other direction);
 *   - every status cell is exactly one of the five statuses, and every
 *     non-proven, non-excluded cell names the issue that tracks the gap;
 *   - every row with an `excluded` cell says why in its Notes column;
 *   - the copy the docs site ships (`apps/docs/data/capability-matrix.md`) is
 *     byte-identical to the canonical file, the same rule the manifest copies
 *     live under (`apps/docs/scripts/check-manifest-sync.ts`).
 *
 * Fails closed: an unreadable file, an empty walk, or a header that does not
 * carry the four entry-point columns is a failure, never a vacuous pass
 * (lessons-learned #9 and #11). The checker's own logic is exercised against
 * synthetic input below so a broken parser cannot report a clean matrix.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROVIDER_CAPABILITIES } from '../providers';

// __dirname is web/src/lib/config/__tests__ — five levels below the repo root.
const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..');
const MATRIX_PATH = join(REPO_ROOT, 'docs', 'capability-matrix.md');
const DOCS_SITE_COPY_PATH = join(REPO_ROOT, 'apps', 'docs', 'data', 'capability-matrix.md');
const MANIFEST_PATH = join(REPO_ROOT, 'mcp-server', 'manifest', 'commands.json');

export const MATRIX_STATUSES = [
  'proven',
  'implemented-unverified',
  'partial',
  'unavailable',
  'excluded',
] as const;
export type MatrixStatus = (typeof MATRIX_STATUSES)[number];

/** The four entry-point columns, in the order the document presents them. */
export const ENTRY_POINT_COLUMNS = ['Human/UI', 'In-app AI', 'Scripting', 'External MCP'] as const;
export type EntryPointColumn = (typeof ENTRY_POINT_COLUMNS)[number];
const NOTES_COLUMN = 'Notes';

/**
 * A status cell is the bare status, optionally followed by one space and a
 * parenthesised, comma-separated list of GitHub issue references:
 * `partial (#9284)`, `unavailable (#9117, #9522)`. Anything else — a second
 * word, a bare issue number, a trailing period — is rejected so the cell
 * vocabulary cannot grow by accident.
 */
const CELL_RE = /^(proven|implemented-unverified|partial|unavailable|excluded)(?: \((#\d+(?:, #\d+)*)\))?$/;
const ROW_KEY_RE = /^`(generation|commands):([a-z0-9_]+)`$/;

export interface MatrixRow {
  kind: 'generation' | 'commands';
  key: string;
  /** 1-indexed line in the markdown, for failure messages. */
  line: number;
  cells: Record<EntryPointColumn, string>;
  notes: string;
}

export interface MatrixProblem {
  row: string;
  line: number;
  column: string;
  reason: string;
}

export interface MatrixReport {
  missingCapabilities: string[];
  missingCategories: string[];
  staleRows: string[];
  problems: MatrixProblem[];
}

function splitTableRow(line: string): string[] {
  // `| a | b |` -> ['a', 'b']. Leading/trailing pipes produce empty first/last
  // entries, which are dropped; interior empties are kept as empty cells.
  const parts = line.split('|').map((cell) => cell.trim());
  return parts.slice(1, parts.length - 1);
}

function isSeparatorRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

/**
 * Walk every markdown table in the document and return each row whose first
 * cell is a `generation:` or `commands:` key. The column layout is read from
 * the nearest header row above, so tables may order columns freely as long as
 * the four entry-point columns and Notes are present.
 */
export function parseMatrix(markdown: string): MatrixRow[] {
  const rows: MatrixRow[] = [];
  let header: string[] | null = null;
  const lines = markdown.split(/\r?\n/);

  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line.startsWith('|')) {
      header = null;
      return;
    }
    const cells = splitTableRow(line);
    if (isSeparatorRow(cells)) return;
    if (header === null) {
      header = cells;
      return;
    }

    const keyMatch = ROW_KEY_RE.exec(cells[0] ?? '');
    if (!keyMatch) return;

    const columnIndex = (name: string) => header!.indexOf(name);
    const missingColumns = [...ENTRY_POINT_COLUMNS, NOTES_COLUMN].filter((c) => columnIndex(c) < 0);
    if (missingColumns.length > 0) {
      throw new Error(
        `Table header at line ${index + 1} lacks column(s) ${missingColumns.join(', ')} ` +
          `(header: ${header!.join(' | ')})`,
      );
    }

    const cellFor = (column: EntryPointColumn) => cells[columnIndex(column)] ?? '';
    rows.push({
      kind: keyMatch[1] as MatrixRow['kind'],
      key: keyMatch[2],
      line: index + 1,
      cells: {
        'Human/UI': cellFor('Human/UI'),
        'In-app AI': cellFor('In-app AI'),
        Scripting: cellFor('Scripting'),
        'External MCP': cellFor('External MCP'),
      },
      notes: cells[columnIndex(NOTES_COLUMN)] ?? '',
    });
  });

  return rows;
}

export function checkMatrix(
  rows: readonly MatrixRow[],
  expected: { capabilities: readonly string[]; categories: readonly string[] },
): MatrixReport {
  const generationKeys = new Set(rows.filter((r) => r.kind === 'generation').map((r) => r.key));
  const commandKeys = new Set(rows.filter((r) => r.kind === 'commands').map((r) => r.key));
  const capabilities = new Set(expected.capabilities);
  const categories = new Set(expected.categories);

  const report: MatrixReport = {
    missingCapabilities: expected.capabilities.filter((c) => !generationKeys.has(c)).sort(),
    missingCategories: expected.categories.filter((c) => !commandKeys.has(c)).sort(),
    staleRows: rows
      .filter((r) => (r.kind === 'generation' ? !capabilities.has(r.key) : !categories.has(r.key)))
      .map((r) => `${r.kind}:${r.key}`)
      .sort(),
    problems: [],
  };

  const seen = new Set<string>();
  for (const row of rows) {
    const id = `${row.kind}:${row.key}`;
    if (seen.has(id)) {
      report.problems.push({ row: id, line: row.line, column: '(row)', reason: 'duplicate row' });
    }
    seen.add(id);

    let hasExcluded = false;
    for (const column of ENTRY_POINT_COLUMNS) {
      const cell = row.cells[column];
      const match = CELL_RE.exec(cell);
      if (!match) {
        report.problems.push({
          row: id,
          line: row.line,
          column,
          reason: `"${cell}" is not one of ${MATRIX_STATUSES.join(' | ')} (optionally followed by " (#issue[, #issue])")`,
        });
        continue;
      }
      const status = match[1] as MatrixStatus;
      const issues = match[2];
      if (status === 'excluded') hasExcluded = true;
      if (status !== 'proven' && status !== 'excluded' && !issues) {
        report.problems.push({
          row: id,
          line: row.line,
          column,
          reason: `"${status}" must name the issue tracking the gap, e.g. "${status} (#1234)"`,
        });
      }
      if (status === 'proven' && issues) {
        report.problems.push({
          row: id,
          line: row.line,
          column,
          reason: 'a proven cell carries evidence in Notes, not an issue reference',
        });
      }
    }
    if (hasExcluded && row.notes.trim() === '') {
      report.problems.push({
        row: id,
        line: row.line,
        column: NOTES_COLUMN,
        reason: 'a row with an excluded cell must say why in Notes',
      });
    }
  }

  return report;
}

export function formatProblems(problems: readonly MatrixProblem[]): string {
  return problems
    .map((p) => `  ${p.row} [${p.column}] (docs/capability-matrix.md:${p.line}): ${p.reason}`)
    .join('\n');
}

function readManifestCategories(): string[] {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as {
    commands: Array<{ category: string }>;
  };
  return [...new Set(manifest.commands.map((c) => c.category))].sort();
}

describe('docs/capability-matrix.md', () => {
  // Read once; every assertion below is a view on the same document.
  const exists = existsSync(MATRIX_PATH);
  const markdown = exists ? readFileSync(MATRIX_PATH, 'utf8') : '';
  const rows = exists ? parseMatrix(markdown) : [];
  const categories = readManifestCategories();
  const report = checkMatrix(rows, { capabilities: PROVIDER_CAPABILITIES, categories });

  it('exists', () => {
    expect(exists, `${MATRIX_PATH} is missing — the README links to it`).toBe(true);
  });

  it('is not empty: the walk found at least one row per capability and per category', () => {
    // Fail closed. A parser that matches nothing must not read as "no problems".
    expect(categories.length).toBeGreaterThan(0);
    expect(PROVIDER_CAPABILITIES.length).toBeGreaterThan(0);
    expect(rows.length).toBeGreaterThanOrEqual(categories.length + PROVIDER_CAPABILITIES.length);
  });

  it('has a row for every PROVIDER_CAPABILITIES entry', () => {
    expect(
      report.missingCapabilities,
      'add a `generation:<capability>` row for each of these (web/src/lib/config/providers.ts)',
    ).toEqual([]);
  });

  it('has a row for every manifest command category', () => {
    expect(
      report.missingCategories,
      'add a `commands:<category>` row for each of these (mcp-server/manifest/commands.json)',
    ).toEqual([]);
  });

  it('has no row for a capability or category that no longer exists', () => {
    expect(report.staleRows, 'delete these rows or restore what they describe').toEqual([]);
  });

  it('uses only the five statuses, with an issue on every non-proven, non-excluded cell', () => {
    expect(report.problems, `\n${formatProblems(report.problems)}\n`).toEqual([]);
  });

  it('defines every status in its legend', () => {
    for (const status of MATRIX_STATUSES) {
      expect(markdown, `legend does not define \`${status}\``).toContain(`\`${status}\``);
    }
  });

  it('says how it is checked', () => {
    expect(markdown).toContain('capabilityMatrix.test.ts');
  });

  // Facts verified on 2026-09-05 (#9720). Both are pinned so the matrix cannot
  // quietly claim otherwise before the tracking issue closes: flipping either
  // means editing this test in the same change, with the evidence.
  it('marks music unavailable through every entry point until #9522 closes', () => {
    const music = rows.find((r) => r.kind === 'generation' && r.key === 'music');
    expect(music).toBeDefined();
    for (const column of ENTRY_POINT_COLUMNS) {
      expect(music!.cells[column], `music / ${column}`).toMatch(/^unavailable \(.*#9522.*\)$/);
    }
  });

  it('marks external MCP unavailable on every row until the #9722 decision', () => {
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.cells['External MCP'], `${row.kind}:${row.key} / External MCP`).toMatch(
        /^unavailable \(.*#9722.*\)$/,
      );
    }
  });

  it('is mirrored byte-for-byte into the docs site deploy root', () => {
    // apps/docs deploys with rootDirectory apps/docs, so the page it renders
    // cannot read docs/ — it reads this copy. Same rule as commands.json.
    expect(existsSync(DOCS_SITE_COPY_PATH), `${DOCS_SITE_COPY_PATH} is missing`).toBe(true);
    const copy = readFileSync(DOCS_SITE_COPY_PATH, 'utf8');
    expect(
      copy === markdown,
      'apps/docs/data/capability-matrix.md differs from docs/capability-matrix.md — copy the canonical file over it',
    ).toBe(true);
  });
});

describe('checkMatrix on synthetic input (the checker can fail)', () => {
  const header = '| Row | Human/UI | In-app AI | Scripting | External MCP | Notes |';
  const separator = '|---|---|---|---|---|---|';
  const good = (key: string, notes = '') =>
    `| \`${key}\` | proven | implemented-unverified (#1) | excluded | unavailable (#2) | ${notes || 'because'} |`;

  it('reports a capability whose row was deleted', () => {
    const md = [header, separator, good('generation:chat'), good('commands:scene')].join('\n');
    const report = checkMatrix(parseMatrix(md), {
      capabilities: ['chat', 'image'],
      categories: ['scene', 'audio'],
    });
    expect(report.missingCapabilities).toEqual(['image']);
    expect(report.missingCategories).toEqual(['audio']);
    expect(report.staleRows).toEqual([]);
    expect(report.problems).toEqual([]);
  });

  it('reports a row for something that no longer exists', () => {
    const md = [header, separator, good('generation:chat'), good('commands:gone')].join('\n');
    const report = checkMatrix(parseMatrix(md), { capabilities: ['chat'], categories: [] });
    expect(report.staleRows).toEqual(['commands:gone']);
  });

  it('rejects a cell that is not one of the five statuses', () => {
    const md = [
      header,
      separator,
      '| `commands:scene` | works | proven | proven | proven | |',
    ].join('\n');
    const report = checkMatrix(parseMatrix(md), { capabilities: [], categories: ['scene'] });
    expect(report.problems).toHaveLength(1);
    expect(report.problems[0]).toMatchObject({ row: 'commands:scene', column: 'Human/UI', line: 3 });
  });

  it('rejects a non-proven cell with no tracking issue, and an excluded row with no note', () => {
    const md = [
      header,
      separator,
      '| `commands:scene` | partial | proven | excluded | unavailable (#9) | |',
    ].join('\n');
    const report = checkMatrix(parseMatrix(md), { capabilities: [], categories: ['scene'] });
    expect(report.problems.map((p) => p.column).sort()).toEqual(['Human/UI', 'Notes']);
  });

  it('rejects a proven cell that carries an issue reference', () => {
    const md = [header, separator, '| `commands:scene` | proven (#1) | proven | proven | proven | |'].join('\n');
    const report = checkMatrix(parseMatrix(md), { capabilities: [], categories: ['scene'] });
    expect(report.problems).toHaveLength(1);
    expect(report.problems[0].column).toBe('Human/UI');
  });

  it('reports a duplicated row', () => {
    const md = [header, separator, good('commands:scene'), good('commands:scene')].join('\n');
    const report = checkMatrix(parseMatrix(md), { capabilities: [], categories: ['scene'] });
    expect(report.problems.map((p) => p.reason)).toEqual(['duplicate row']);
  });

  it('throws when a table with matrix rows lacks an entry-point column', () => {
    const md = ['| Row | Human/UI | Notes |', '|---|---|---|', '| `commands:scene` | proven | x |'].join('\n');
    expect(() => parseMatrix(md)).toThrow(/lacks column\(s\) In-app AI, Scripting, External MCP/);
  });

  it('ignores tables that carry no matrix rows, such as the legend', () => {
    const md = ['| Status | Meaning |', '|---|---|', '| `proven` | verified |'].join('\n');
    expect(parseMatrix(md)).toEqual([]);
  });
});
