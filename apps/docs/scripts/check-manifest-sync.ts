/**
 * check-manifest-sync.ts
 *
 * CI gate: verifies that the canonical mcp-server/manifest/commands.json is
 * structurally identical to EVERY derived copy — web/src/data/commands.json
 * and apps/docs/data/commands.json.
 *
 * The docs copy was unguarded until PF-1019 and had already drifted (it was
 * missing a public command), so the deployed docs under-reported the command
 * count with nothing anywhere reporting a problem. Register every new copy in
 * the `copies` array below or that failure mode comes straight back.
 *
 * Uses JSON structural comparison (parse + sort by name), not text diff,
 * to avoid false failures from formatting differences.
 *
 * Usage (CLI):
 *   npx tsx apps/docs/scripts/check-manifest-sync.ts
 *
 * Or import checkSync() directly in tests.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

// ---- Types ----

export interface SyncResult {
  passed: boolean;
  error?: string;
}

// ---- Core logic (exported for tests) ----

/**
 * Checks that canonical and copy manifests have structurally identical .commands arrays.
 * Sorts by name before comparison to tolerate order differences.
 * Ignores whitespace/formatting differences (structural JSON comparison).
 *
 * @param canonicalPath - Path to the authoritative commands.json
 * @param copyPath - Path to the derived copy commands.json
 */
export function checkSync(canonicalPath: string, copyPath: string): SyncResult {
  let canonical: { commands?: Array<{ name: string }> };
  let copy: { commands?: Array<{ name: string }> };

  try {
    canonical = JSON.parse(fs.readFileSync(canonicalPath, 'utf-8')) as typeof canonical;
  } catch {
    return { passed: false, error: `Cannot read canonical manifest: ${canonicalPath}` };
  }

  try {
    copy = JSON.parse(fs.readFileSync(copyPath, 'utf-8')) as typeof copy;
  } catch {
    return { passed: false, error: `Cannot read copy manifest: ${copyPath}` };
  }

  const sort = (arr: Array<{ name: string }>) =>
    [...arr].sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));

  const canonicalCommands = canonical.commands ?? [];
  const copyCommands = copy.commands ?? [];

  const sa = JSON.stringify(sort(canonicalCommands));
  const sb = JSON.stringify(sort(copyCommands));

  if (sa !== sb) {
    return { passed: false, error: 'MCP manifests are out of sync' };
  }

  return { passed: true };
}

// ---- The command index: a DERIVATION, not a copy ----

/** Canonical manifest, repo-relative. */
export const CANONICAL_MANIFEST_PATH = 'mcp-server/manifest/commands.json';

/** The slim projection client code imports, repo-relative. */
export const COMMAND_INDEX_PATH = 'web/src/data/commandIndex.json';

/**
 * The ONLY fields the command index carries, and this list is a bundle budget.
 *
 * `web/src/lib/mcp/bridgeAllowlist.ts` runs in the editor tab and needs exactly
 * these three to decide what a remote agent may drive. It used to import the
 * whole manifest to get them, so every command's description and JSON parameter
 * schema — 344 KB of JSON, ~205 KB minified — shipped to the browser to answer
 * a question about three short strings (#9954).
 *
 * Adding a fourth field puts that weight back. `checkCommandIndex` fails on any
 * extra key for exactly that reason, so the regression cannot arrive quietly
 * through a well-meaning "just one more field".
 */
export const COMMAND_INDEX_FIELDS = ['name', 'category', 'requiredScope'] as const;

export interface CommandIndexEntry {
  name: string;
  category: string;
  requiredScope: string;
}

/**
 * Sort commands by name and each command's keys alphabetically, so two
 * structurally equal indexes stringify identically regardless of the order
 * their author happened to write them in.
 *
 * Deliberately does NOT drop unknown keys: normalising the actual index through
 * a projection would silently discard an extra field and report a pass, making
 * the check blind to the one regression it exists to catch.
 */
function normaliseIndex(
  commands: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  return [...commands]
    .sort((x, y) => {
      const a = String(x.name ?? '');
      const b = String(y.name ?? '');
      return a < b ? -1 : a > b ? 1 : 0;
    })
    .map((c) => {
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(c).sort()) out[key] = c[key];
      return out;
    });
}

/**
 * Project canonical manifest commands onto the index shape.
 *
 * Exported because `generate-command-index.ts` writes the file with this exact
 * function. A generator carrying its own copy of the field list would be a
 * check that restates its subject: the two drift, and the gate then verifies
 * the generator against itself. One function, two callers.
 */
export function projectCommandIndex(
  commands: Array<Record<string, unknown>>,
): { commands: CommandIndexEntry[] } {
  const sorted = [...commands].sort((x, y) => {
    const a = String(x.name ?? '');
    const b = String(y.name ?? '');
    return a < b ? -1 : a > b ? 1 : 0;
  });
  return {
    commands: sorted.map(
      (c) =>
        Object.fromEntries(COMMAND_INDEX_FIELDS.map((f) => [f, c[f]])) as unknown as
          CommandIndexEntry,
    ),
  };
}

/**
 * Checks that the command index is exactly the projection of canonical.
 *
 * Not a `checkSync` call — `checkSync` demands structural identity, which is
 * the one thing that must never be demanded of the index: the whole point is
 * that it carries less. So this recomputes the projection from canonical and
 * compares, which fails on a missing command, a changed category, a stale
 * scope, AND on an extra field.
 */
export function checkCommandIndex(canonicalPath: string, indexPath: string): SyncResult {
  let canonical: { commands?: Array<Record<string, unknown>> };
  let index: { commands?: Array<Record<string, unknown>> };

  try {
    canonical = JSON.parse(fs.readFileSync(canonicalPath, 'utf-8')) as typeof canonical;
  } catch {
    return { passed: false, error: `Cannot read canonical manifest: ${canonicalPath}` };
  }

  try {
    index = JSON.parse(fs.readFileSync(indexPath, 'utf-8')) as typeof index;
  } catch {
    return {
      passed: false,
      error:
        `Cannot read command index: ${indexPath} — regenerate it with ` +
        '`npm run generate:command-index`',
    };
  }

  const expected = normaliseIndex(
    projectCommandIndex(canonical.commands ?? []).commands as unknown as Array<
      Record<string, unknown>
    >,
  );
  const actual = normaliseIndex(index.commands ?? []);

  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    return {
      passed: false,
      error:
        'Command index is not the projection of the canonical manifest — ' +
        'regenerate it with `npm run generate:command-index`',
    };
  }

  return { passed: true };
}

// ---- CLI wrapper (only runs when executed directly) ----

const isMainModule =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMainModule) {
  const canonical = path.join(repoRoot, 'mcp-server/manifest/commands.json');

  /**
   * THREE copies exist, not two.
   *
   * `apps/docs/data/commands.json` is the copy the docs site actually ships —
   * it is inside the Vercel deploy root (`rootDirectory: apps/docs`), which is
   * why both the page generator and the runtime reader point at it. It was
   * unguarded, and it had already drifted: it was missing the PUBLIC command
   * `setup_game_from_description`, so the live docs silently documented 281
   * commands instead of 282, with nothing anywhere reporting a problem
   * (PF-1019).
   *
   * Guarding the copy that gets deployed is the whole point. Adding a copy
   * without adding it here recreates exactly this bug.
   */
  const copies = [
    path.join(repoRoot, 'web/src/data/commands.json'),
    path.join(repoRoot, 'apps/docs/data/commands.json'),
  ];

  let failed = false;
  for (const copy of copies) {
    const result = checkSync(canonical, copy);
    if (!result.passed) {
      console.error(`${result.error}: ${path.relative(repoRoot, copy)}`);
      failed = true;
    }
  }

  // The index is derived, not copied, so it gets its own comparison — but it
  // is checked HERE, in the one place this file declares as the registry of
  // everything downstream of the canonical manifest. A derived artifact
  // guarded somewhere else is a derived artifact nobody finds (PF-1019).
  const indexPath = path.join(repoRoot, COMMAND_INDEX_PATH);
  const indexResult = checkCommandIndex(canonical, indexPath);
  if (!indexResult.passed) {
    console.error(`${indexResult.error}`);
    failed = true;
  }

  if (failed) {
    process.exit(1);
  }

  console.log(
    `Manifest sync check passed (${copies.length} copies + the command index).`,
  );
}
