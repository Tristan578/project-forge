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
 *   - the Legend TABLE (not just the prose) defines all five statuses;
 *   - the manifest counts the prose quotes (351 / 41 / 282 / 69) and the
 *     per-category `public/internal` count that opens every `commands:` row's
 *     Notes agree with `mcp-server/manifest/commands.json` — the README's "350"
 *     rotted precisely because nothing compared it against the manifest;
 *   - the External MCP column follows `bridgeAllowlist.ts`: `excluded` for a
 *     category `BRIDGE_DENIED_CATEGORIES` names (a design decision), and
 *     `unavailable (#9722)` for every category the bridge allows (production
 *     has no bridge);
 *   - the copy the docs site ships (`apps/docs/data/capability-matrix.json`)
 *     reproduces the canonical file line for line, the same rule the manifest
 *     copies live under (`apps/docs/scripts/check-manifest-sync.ts`);
 *   - and, in the last describe, README.md's command counts are derived from
 *     the manifest, `getChatTools()` and `bridgeAllowedCommands()` rather than
 *     transcribed — the "350" that rotted was a README number too.
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
import { BRIDGE_DENIED_CATEGORIES, bridgeAllowedCommands } from '@/lib/mcp/bridgeAllowlist';
import { getChatTools } from '@/lib/chat/tools';

// __dirname is web/src/lib/config/__tests__ — five levels below the repo root.
const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..');
const MATRIX_PATH = join(REPO_ROOT, 'docs', 'capability-matrix.md');
const README_PATH = join(REPO_ROOT, 'README.md');
const DOCS_SITE_COPY_PATH = join(REPO_ROOT, 'apps', 'docs', 'data', 'capability-matrix.json');
const MANIFEST_PATH = join(REPO_ROOT, 'mcp-server', 'manifest', 'commands.json');

/** Read a repo-relative path, or '' when it is missing. Callers assert non-empty. */
const read = (repoRelative: string) => {
  const abs = join(REPO_ROOT, ...repoRelative.split('/'));
  return existsSync(abs) ? readFileSync(abs, 'utf8') : '';
};

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

interface ManifestFacts {
  categories: string[];
  total: number;
  publicCount: number;
  internalCount: number;
  /** `category -> [public, internal]`, the pair each `commands:` row's Notes opens with. */
  perCategory: Map<string, [number, number]>;
}

function readManifestFacts(): ManifestFacts {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as {
    commands: Array<{ category: string; visibility: string }>;
  };
  const perCategory = new Map<string, [number, number]>();
  let publicCount = 0;
  for (const cmd of manifest.commands) {
    const pair = perCategory.get(cmd.category) ?? [0, 0];
    if (cmd.visibility === 'public') {
      pair[0] += 1;
      publicCount += 1;
    } else {
      pair[1] += 1;
    }
    perCategory.set(cmd.category, pair);
  }
  return {
    categories: [...perCategory.keys()].sort(),
    total: manifest.commands.length,
    publicCount,
    internalCount: manifest.commands.length - publicCount,
    perCategory,
  };
}

/**
 * The rows of the first pipe table under a given `## Heading`, split into
 * cells, with the separator row dropped. Empty when the heading is missing or
 * no table follows it — callers assert non-emptiness (lesson 11).
 */
export function tableUnderHeading(markdown: string, heading: string): string[][] {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === heading);
  if (start < 0) return [];
  const rows: string[][] = [];
  let inTable = false;
  for (const raw of lines.slice(start + 1)) {
    const line = raw.trim();
    if (/^#{1,6}\s/.test(line)) break;
    if (!line.startsWith('|')) {
      if (inTable) break;
      continue;
    }
    inTable = true;
    const cells = splitTableRow(line);
    if (!isSeparatorRow(cells)) rows.push(cells);
  }
  return rows;
}

describe('docs/capability-matrix.md', () => {
  // Read once; every assertion below is a view on the same document.
  const exists = existsSync(MATRIX_PATH);
  const markdown = exists ? readFileSync(MATRIX_PATH, 'utf8') : '';
  const rows = exists ? parseMatrix(markdown) : [];
  const facts = readManifestFacts();
  const { categories } = facts;
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

  it('defines every status in the table under the Legend heading', () => {
    // The statuses are backticked in the Facts prose and in "How this file is
    // checked" too, so a whole-document `toContain` would stay green with the
    // Legend table deleted. Read the table itself.
    const [header, ...legend] = tableUnderHeading(markdown, '## Legend');
    expect(header?.[0], 'no table follows the ## Legend heading').toBe('Status');
    const keys = legend.map((cells) => cells[0]);
    expect(legend.length, 'the legend table must define exactly the five statuses').toBe(MATRIX_STATUSES.length);
    for (const status of MATRIX_STATUSES) {
      expect(keys, `legend table does not define \`${status}\``).toContain(`\`${status}\``);
    }
    for (const cells of legend) {
      expect(cells[1]?.trim() ?? '', `legend row ${cells[0]} has no definition`).not.toBe('');
    }
  });

  it('says how it is checked', () => {
    expect(markdown).toContain('capabilityMatrix.test.ts');
  });

  it('quotes the manifest counts the manifest actually has', () => {
    // These are prose, so nothing else compares them; the README's "350" rotted
    // this way. Derived from the manifest, never hard-coded here.
    expect(facts.total).toBeGreaterThan(0);
    expect(markdown).toContain(
      `holds **${facts.total}** commands across **${facts.categories.length}** categories, ` +
        `${facts.publicCount} public and ${facts.internalCount} internal`,
    );
  });

  it('opens every commands row Notes with the public/internal count from the manifest', () => {
    const commandRows = rows.filter((r) => r.kind === 'commands');
    expect(commandRows.length).toBe(facts.categories.length);
    for (const row of commandRows) {
      const [publicCount, internalCount] = facts.perCategory.get(row.key) ?? [NaN, NaN];
      expect(row.notes, `commands:${row.key} (line ${row.line}) Notes must start with "${publicCount}/${internalCount}."`).toMatch(
        new RegExp(`^${publicCount}/${internalCount}\\. `),
      );
    }
  });

  // Facts verified on 2026-09-05 (#9720). Pinned so the matrix cannot quietly
  // claim otherwise before the tracking issue closes: flipping one means
  // editing this test in the same change, with the evidence.
  it('marks music unavailable through every non-bridge entry point until #9522 closes', () => {
    const music = rows.find((r) => r.kind === 'generation' && r.key === 'music');
    expect(music).toBeDefined();
    for (const column of ENTRY_POINT_COLUMNS) {
      if (column === 'External MCP') continue; // governed by the bridge allowlist below
      expect(music!.cells[column], `music / ${column}`).toMatch(/^unavailable \(.*#9522.*\)$/);
    }
  });

  it('follows the bridge allowlist in the External MCP column', () => {
    // `excluded` is a design decision (BRIDGE_DENIED_CATEGORIES says why);
    // `unavailable (#9722)` is the production gate for everything the bridge
    // WOULD execute. Generation capabilities are all `generation`-category or
    // `ai:generate`-scoped commands, which the bridge denies, so they are
    // `excluded` too — a `partial`/`unavailable` there would claim a path the
    // allowlist closes on purpose.
    expect(rows.length).toBeGreaterThan(0);
    expect(BRIDGE_DENIED_CATEGORIES.size).toBeGreaterThan(0);
    for (const row of rows) {
      const cell = row.cells['External MCP'];
      const label = `${row.kind}:${row.key} / External MCP`;
      if (row.kind === 'generation' || BRIDGE_DENIED_CATEGORIES.has(row.key)) {
        expect(cell, `${label} — the bridge allowlist denies this by design`).toBe('excluded');
      } else {
        expect(cell, `${label} — the bridge cannot attach to production`).toBe('unavailable (#9722)');
      }
    }
  });

  it('is mirrored line for line into the docs site deploy root', () => {
    // apps/docs deploys with rootDirectory apps/docs, so the page it renders
    // cannot read docs/ — it imports this copy. A JSON module is a bundler-
    // owned edge (a runtime `readFileSync` of the .md is what 500'd /mcp in
    // #9718), and `lines` keeps the diff one line per markdown line.
    expect(existsSync(DOCS_SITE_COPY_PATH), `${DOCS_SITE_COPY_PATH} is missing`).toBe(true);
    const copy = JSON.parse(readFileSync(DOCS_SITE_COPY_PATH, 'utf8')) as { lines?: unknown };
    expect(Array.isArray(copy.lines), 'apps/docs/data/capability-matrix.json must carry a `lines` array').toBe(true);
    expect(
      (copy.lines as string[]).join('\n') === markdown,
      'apps/docs/data/capability-matrix.json is stale — run `npm run sync:capability-matrix` from the repo root',
    ).toBe(true);
  });
});

/**
 * Every command count this repo quotes in prose, derived rather than
 * transcribed.
 *
 * The README said "350 commands" for months while the manifest held 351,
 * because the number was prose and nothing compared it against the artifact
 * (#9720). Fixing the digit without pinning it just resets the clock — and
 * pinning ONLY the README resets it everywhere else, which is exactly what
 * happened: when this block was widened, `docs/capability-matrix.md` (the file
 * the README now sends a prospective creator to) had two unpinned derived
 * counts of its own, `docs/known-limitations.md` repeated one of them, and
 * `docs/reference/commands.md`, `docs/features/limitations-guide.md`, the root
 * `package.json` description, `CONTRIBUTING.md`'s architecture diagram, both
 * `file-map.md` mirrors and `.claude/docs/engine-api-reference.md` were still
 * quoting 322 / 350 with nothing comparing them against anything.
 *
 * Every count below is computed from the source the sentence cites: the
 * manifest for the total / category / public counts, `getChatTools()` for what
 * the in-app AI is offered, `bridgeAllowedCommands()` for what the MCP bridge
 * will execute.
 *
 * Two halves, and both are needed. The positive claims catch a pinned sentence
 * going stale; the sweep catches a NEW sentence quoting a stale count, which
 * the positive list alone would not see (lesson #11 — assert on content, and
 * assert the walk was non-empty).
 */
interface CountedDoc {
  /** Repo-relative path, used in failure messages. */
  path: string;
  /** Substrings the file must carry verbatim, built from the derived counts. */
  claims: string[];
}

/**
 * The shapes in which a manifest count is quoted. Shape-based, not
 * line-based: "returns 500" and "800 lines" sit on lines that mention commands
 * and are not command counts, so the older line-scoped sweep could only be run
 * over the README. Matching the noun instead lets the same sweep cover every
 * file in the table.
 *
 * Group 1 (and group 2, where present) is a command count; `CATEGORY_PATTERN`
 * captures a category count. `#`-prefixed and dotted numbers are excluded so
 * issue references, `PF-330` and version strings are not swept up.
 */
const COMMAND_COUNT_PATTERNS = [
  // "351 commands", "351 MCP commands", "351-command MCP manifest".
  /(?<![#\w.])(\d{3})(?:-commands?\b|\s+(?:MCP\s+)?commands?\b)/g,
  // "275 of the 351" — the entry-point subset sentences in the matrix.
  /(?<![#\w.])(\d{3})\s+of\s+the\s+(\d{3})\b/g,
] as const;
/**
 * A category count only counts as a MANIFEST category count when it is quoted
 * next to a three-digit command count: "351 commands across 41 categories",
 * "351 across 41 categories (282 public)", "MCP Server (351 commands, 41
 * categories)". The README's "73 node types across 10 categories" is about
 * visual-scripting nodes and must not be swept up.
 */
const CATEGORY_PATTERN = /(?<![#\w.])\d{3}\s*(?:commands?)?(?:\s+across\s+|,\s+)(\d{2,3})\s+categories\b/g;

describe('command counts quoted across the repo', () => {
  const facts = readManifestFacts();
  const chatToolCount = getChatTools().length;
  const bridgeCount = bridgeAllowedCommands().length;
  const total = facts.total;
  const categoryCount = facts.categories.length;

  const docs: CountedDoc[] = [
    {
      path: 'README.md',
      claims: [
        // Line 3 — the opening sentence.
        `${total}-command MCP manifest`,
        // The stats table, and the repo-map comment near the bottom.
        `${total} across ${categoryCount} categories (${facts.publicCount} public)`,
        `${total} commands across ${categoryCount} categories`,
        // The "What is SpawnForge" paragraph.
        `${total} of them (${facts.publicCount} public)`,
        // getChatTools(): every `:write`-scoped command plus the `query` category.
        `offered ${chatToolCount} of the ${total} manifest commands`,
        // bridgeAllowedCommands(): the allowlist minus the denied scopes.
        `an allowlist of ${bridgeCount} commands`,
        `drive ${bridgeCount} of those commands`,
      ],
    },
    {
      // The document this suite gates, and the one the README now points a
      // prospective creator at. Both counts are derived; neither was pinned.
      path: 'docs/capability-matrix.md',
      claims: [`${chatToolCount} of the ${total}`, `executes ${bridgeCount} of the ${total} commands`],
    },
    {
      path: 'docs/known-limitations.md',
      claims: [`${bridgeCount} of the ${total} commands`],
    },
    {
      // Generated by docs/scripts/generate-reference.ts, which derives the
      // count — so a mismatch here means the file was not regenerated.
      path: 'docs/reference/commands.md',
      claims: [`all ${total} MCP commands`],
    },
    { path: 'docs/features/limitations-guide.md', claims: [`${total} MCP commands`] },
    // The npm-visible description of the repo.
    { path: 'package.json', claims: [`${total} MCP commands`] },
    // The first architecture picture a new contributor sees.
    { path: 'CONTRIBUTING.md', claims: [`MCP Server (${total} commands, ${categoryCount} categories)`] },
    { path: '.claude/rules/file-map.md', claims: [`${total} commands across ${categoryCount} categories`] },
    // The cross-IDE mirror of the file above (.claude/tools/dx-audit.sh).
    { path: '.windsurf/rules/file-map.md', claims: [`${total} commands across ${categoryCount} categories`] },
    { path: '.claude/docs/engine-api-reference.md', claims: [`${total} commands across ${categoryCount} categories`] },
  ];

  it('derives every count from code, and every listed file is readable (never a vacuous pass)', () => {
    expect(total).toBeGreaterThan(0);
    expect(categoryCount).toBeGreaterThan(0);
    expect(chatToolCount).toBeGreaterThan(0);
    expect(bridgeCount).toBeGreaterThan(0);
    expect(docs.length).toBeGreaterThanOrEqual(10);
    for (const doc of docs) {
      expect(read(doc.path).length, `${doc.path} is missing or empty`).toBeGreaterThan(0);
    }
    // README_PATH is what the older, README-only version of this block read.
    expect(existsSync(README_PATH), `${README_PATH} is missing`).toBe(true);
  });

  it.each(docs.map((doc) => [doc.path, doc.claims] as const))(
    '%s quotes the counts the code produces',
    (path, claims) => {
      const text = read(path);
      expect(claims.length, `${path} is listed with no claim to check`).toBeGreaterThan(0);
      for (const claim of claims) {
        expect(text, `${path} no longer says "${claim}"`).toContain(claim);
      }
    },
  );

  it('quotes no OTHER command or category count in any of them', () => {
    const allowedCommands = new Set([total, facts.publicCount, chatToolCount, bridgeCount]);
    const offenders: string[] = [];
    let inspected = 0;
    for (const doc of docs) {
      read(doc.path)
        .split(/\r?\n/)
        .forEach((line, i) => {
          for (const pattern of COMMAND_COUNT_PATTERNS) {
            for (const match of line.matchAll(pattern)) {
              for (const captured of match.slice(1).filter(Boolean)) {
                inspected += 1;
                if (!allowedCommands.has(Number(captured))) {
                  offenders.push(`${doc.path}:${i + 1}: ${captured} commands`);
                }
              }
            }
          }
          for (const match of line.matchAll(CATEGORY_PATTERN)) {
            inspected += 1;
            if (Number(match[1]) !== categoryCount) {
              offenders.push(`${doc.path}:${i + 1}: ${match[1]} categories`);
            }
          }
        });
    }
    // A zero-item walk reads as zero problems found; it would mean the
    // patterns or the documents changed shape, not that the counts are clean.
    expect(inspected, 'the count sweep inspected no numbers at all').toBeGreaterThanOrEqual(20);
    expect(
      offenders,
      `\ncounts matching none of ${[...allowedCommands].join('/')} commands or ${categoryCount} categories:\n${offenders.join('\n')}\n`,
    ).toEqual([]);
  });
});

describe('tableUnderHeading on synthetic input', () => {
  it('returns the first table after the heading and stops at the next heading', () => {
    const md = ['## A', '', 'intro', '', '| K | V |', '|---|---|', '| `x` | one |', '', '## B', '| K | V |', '|---|---|', '| `y` | two |'].join('\n');
    expect(tableUnderHeading(md, '## A')).toEqual([['K', 'V'], ['`x`', 'one']]);
    expect(tableUnderHeading(md, '## B')).toEqual([['K', 'V'], ['`y`', 'two']]);
  });

  it('returns nothing for a missing heading or a heading with no table', () => {
    expect(tableUnderHeading('## A\n\nprose only\n\n## B', '## A')).toEqual([]);
    expect(tableUnderHeading('## A\n| K |\n|---|\n| 1 |', '## Missing')).toEqual([]);
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

/**
 * `apps/docs/data/capability-matrix.json` is a generated copy of a repo-root
 * source, living inside a deploy root that cannot see above itself — the same
 * shape as the three artifacts `CLAUDE.md` already warns about, with the same
 * failure: edit the source, skip the regen, ship a stale page. The contract
 * only helps if it says so, and the always-loaded line said "Three" while this
 * was the fourth. Pinned here because nothing else compares the prose to the
 * artifact set it enumerates.
 */
describe('the capability-matrix copy is registered as a generated-artifact sync gate', () => {
  const claudeMd = read('CLAUDE.md');
  const recipe = read('.claude/rules/gotchas-build-ci.md');

  it('both files are readable (never a vacuous pass)', () => {
    expect(claudeMd.length, 'CLAUDE.md is missing or empty').toBeGreaterThan(0);
    expect(recipe.length, '.claude/rules/gotchas-build-ci.md is missing or empty').toBeGreaterThan(0);
  });

  it('CLAUDE.md counts four artifacts and names every one of them', () => {
    const line = claudeMd
      .split(/\r?\n/)
      .find((l) => /generated-artifact sync gates/.test(l));
    expect(line, 'CLAUDE.md no longer carries the generated-artifact sync-gate line').toBeDefined();
    expect(line).toContain('Four generated-artifact sync gates');
    for (const artifact of [
      'package-lock.json',
      '*.lock.yml',
      'docs/api/openapi.json',
      'apps/docs/data/capability-matrix.json',
    ]) {
      expect(line, `the sync-gate line no longer names ${artifact}`).toContain(artifact);
    }
  });

  it('the fix recipe CLAUDE.md points at carries the new artifact and its regen command', () => {
    expect(recipe).toContain('apps/docs/data/capability-matrix.json');
    expect(recipe).toContain('npm run sync:capability-matrix');
  });
});
