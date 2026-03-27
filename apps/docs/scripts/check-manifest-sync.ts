/**
 * check-manifest-sync.ts
 *
 * CI gate: verifies that mcp-server/manifest/commands.json and
 * web/src/data/commands.json are structurally identical.
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
  const result = checkSync(
    path.join(repoRoot, 'mcp-server/manifest/commands.json'),
    path.join(repoRoot, 'web/src/data/commands.json'),
  );

  if (!result.passed) {
    console.error(result.error);
    process.exit(1);
  }

  console.log('Manifest sync check passed.');
}
