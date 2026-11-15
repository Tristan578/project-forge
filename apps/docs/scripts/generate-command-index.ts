/**
 * generate-command-index.ts
 *
 * Regenerates `web/src/data/commandIndex.json` — the slim projection of the
 * canonical MCP manifest that CLIENT code imports.
 *
 * Run it after any change to `mcp-server/manifest/commands.json`:
 *
 *   npm run generate:command-index
 *
 * `check-manifest-sync.ts` fails the Docs Internal Gate if the committed index
 * is not what this script would write, so a forgotten regeneration is a red
 * check on the PR that caused it rather than a silent drift.
 *
 * It lives beside the check, and imports the projection FROM the check, on
 * purpose: a generator with its own copy of the field list drifts from the gate
 * that verifies it, and the gate then only proves the generator agrees with
 * itself.
 *
 * Usage (CLI):
 *   npx tsx apps/docs/scripts/generate-command-index.ts
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  projectCommandIndex,
  COMMAND_INDEX_PATH,
  CANONICAL_MANIFEST_PATH,
} from './check-manifest-sync.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

const canonicalPath = path.join(repoRoot, CANONICAL_MANIFEST_PATH);
const outPath = path.join(repoRoot, COMMAND_INDEX_PATH);

const canonical = JSON.parse(fs.readFileSync(canonicalPath, 'utf-8')) as {
  commands?: Array<Record<string, unknown>>;
};

const commands = canonical.commands ?? [];
if (commands.length === 0) {
  console.error(
    `Refusing to write an empty index: ${CANONICAL_MANIFEST_PATH} has no commands.`,
  );
  process.exit(2);
}

const index = projectCommandIndex(commands);
fs.writeFileSync(outPath, JSON.stringify(index, null, 2) + '\n', 'utf-8');

console.log(
  `Wrote ${COMMAND_INDEX_PATH}: ${index.commands.length} commands, ` +
    `${fs.statSync(outPath).size} bytes ` +
    `(canonical is ${fs.statSync(canonicalPath).size} bytes).`,
);
