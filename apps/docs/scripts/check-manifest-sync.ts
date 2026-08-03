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

  if (failed) {
    process.exit(1);
  }

  console.log(`Manifest sync check passed (${copies.length} copies).`);
}
