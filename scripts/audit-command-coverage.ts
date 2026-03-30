#!/usr/bin/env node
/**
 * audit-command-coverage.ts
 *
 * Compares MCP commands in mcp-server/manifest/commands.json against handler
 * registrations in web/src/lib/chat/executor.ts.
 *
 * Usage:
 *   node --loader ts-node/esm scripts/audit-command-coverage.ts
 *   # or:
 *   npx ts-node scripts/audit-command-coverage.ts
 *
 * Output:
 *   - Total command count in manifest (public + internal)
 *   - Number of handler keys extracted from executor.ts
 *   - List of manifest commands WITHOUT a registered handler (coverage gaps)
 *   - List of handler names NOT in the manifest (orphaned handlers)
 *   - Exit code 0 if zero gaps; 1 if any gaps found (for CI integration)
 *
 * Strategy:
 *   The manifest is parsed as JSON. Handler names are extracted from
 *   executor.ts by scanning for spread keys in the handlerRegistry object.
 *   Each handler file is then parsed to extract its exported keys using a
 *   regex that matches object-literal handler keys.
 *
 *   This is a static-analysis approach — it does NOT require building
 *   TypeScript, so it works in Node with no compilation step.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_ROOT = path.resolve(__dirname, '..');
const MANIFEST_PATH = path.join(REPO_ROOT, 'mcp-server/manifest/commands.json');
const EXECUTOR_PATH = path.join(REPO_ROOT, 'web/src/lib/chat/executor.ts');
const HANDLERS_DIR = path.join(REPO_ROOT, 'web/src/lib/chat/handlers');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface ManifestCommand {
  name: string;
  category: string;
  visibility?: string;
}

// ---------------------------------------------------------------------------
// Step 1: Load manifest commands
// ---------------------------------------------------------------------------
function loadManifestCommands(): ManifestCommand[] {
  const raw = fs.readFileSync(MANIFEST_PATH, 'utf8');
  const parsed = JSON.parse(raw) as ManifestCommand[];
  if (!Array.isArray(parsed)) {
    throw new Error('Manifest root must be an array of command objects');
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Step 2: Extract handler module file names from executor.ts
// ---------------------------------------------------------------------------
function extractHandlerFiles(): string[] {
  const src = fs.readFileSync(EXECUTOR_PATH, 'utf8');
  // Match: import { fooHandlers } from './handlers/fooHandlers';
  const importRe = /from\s+'\.\/handlers\/([^']+)'/g;
  const files: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = importRe.exec(src)) !== null) {
    // Exclude the 'types' and 'helpers' modules — they don't contain handlers
    if (m[1] !== 'types' && m[1] !== 'helpers') {
      files.push(m[1]);
    }
  }
  return [...new Set(files)];
}

// ---------------------------------------------------------------------------
// Step 3: Parse each handler file for registered handler keys
// ---------------------------------------------------------------------------
function extractHandlerKeys(handlerFile: string): string[] {
  const filePath = path.join(HANDLERS_DIR, `${handlerFile}.ts`);
  if (!fs.existsSync(filePath)) {
    console.warn(`  [warn] Handler file not found: ${filePath}`);
    return [];
  }

  const src = fs.readFileSync(filePath, 'utf8');
  const keys = new Set<string>();

  // Match object literal keys that look like command names, e.g.:
  //   spawn_entity: async (args, ctx) => {
  //   'spawn_entity': async (args, ctx) => {
  const objectKeyRe = /^\s+['"]?([a-z][a-z0-9_]*)['"]?\s*:/gm;
  let m: RegExpExecArray | null;
  while ((m = objectKeyRe.exec(src)) !== null) {
    const key = m[1];
    // Filter out TypeScript/JS reserved words and common non-handler keys
    if (!['import', 'export', 'const', 'let', 'async', 'return', 'function'].includes(key)) {
      keys.add(key);
    }
  }

  return [...keys];
}

// ---------------------------------------------------------------------------
// Step 4: Build complete set of registered handler names
// ---------------------------------------------------------------------------
function buildRegisteredHandlers(): Set<string> {
  const handlerFiles = extractHandlerFiles();
  const allKeys = new Set<string>();

  for (const file of handlerFiles) {
    const keys = extractHandlerKeys(file);
    for (const k of keys) allKeys.add(k);
  }

  return allKeys;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main(): void {
  console.log('SpawnForge MCP Command Coverage Audit');
  console.log('======================================\n');

  const commands = loadManifestCommands();
  const publicCommands = commands.filter(c => c.visibility !== 'internal');
  const internalCommands = commands.filter(c => c.visibility === 'internal');
  console.log(`Manifest: ${commands.length} commands total`);
  console.log(`  ${publicCommands.length} public, ${internalCommands.length} internal\n`);

  const handlerFiles = extractHandlerFiles();
  console.log(`Handler files imported in executor.ts: ${handlerFiles.length}`);

  const registeredHandlers = buildRegisteredHandlers();
  console.log(`Registered handler keys parsed: ${registeredHandlers.size}\n`);

  const manifestNames = new Set(commands.map(c => c.name));
  const gaps = commands.filter(c => !registeredHandlers.has(c.name));
  const orphans = [...registeredHandlers].filter(h => !manifestNames.has(h));

  if (gaps.length === 0) {
    console.log('[OK] All manifest commands have registered handlers.\n');
  } else {
    console.log(`GAPS -- ${gaps.length} manifest command(s) without handlers:`);
    const byCategory = new Map<string, ManifestCommand[]>();
    for (const cmd of gaps) {
      if (!byCategory.has(cmd.category)) byCategory.set(cmd.category, []);
      byCategory.get(cmd.category)!.push(cmd);
    }
    for (const [category, cmds] of [...byCategory.entries()].sort()) {
      console.log(`\n  [${category}]`);
      for (const cmd of cmds) {
        const vis = cmd.visibility === 'internal' ? ' (internal)' : '';
        console.log(`    - ${cmd.name}${vis}`);
      }
    }
    console.log('');
  }

  if (orphans.length > 0) {
    console.log(`ORPHANS -- ${orphans.length} handler key(s) not in manifest:`);
    for (const h of [...orphans].sort()) {
      console.log(`  - ${h}`);
    }
    console.log('');
  } else {
    console.log('[OK] No orphaned handlers found.\n');
  }

  const covered = commands.length - gaps.length;
  const pct = ((covered / commands.length) * 100).toFixed(1);
  console.log(`Coverage: ${covered}/${commands.length} commands (${pct}%)`);

  process.exit(gaps.length > 0 ? 1 : 0);
}

main();
