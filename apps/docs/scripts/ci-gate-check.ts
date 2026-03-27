/**
 * ci-gate-check.ts
 *
 * CI gate: asserts no internal command names appear in generated public MDX files.
 * Reads generated MDX from content/mcp/, cross-references with commands.json manifest.
 *
 * Usage (CLI):
 *   npx tsx apps/docs/scripts/ci-gate-check.ts
 *
 * Or import checkGate() directly in tests.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import matter from 'gray-matter';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---- Types ----

export interface GateResult {
  passed: boolean;
  errors: string[];
  checkedCount: number;
}

// ---- Core logic (exported for tests) ----

/**
 * Core gate logic — testable, no side effects (no process.exit).
 *
 * Parses all *.mdx files in contentDir (excluding index.mdx),
 * reads manifest to get internal command names,
 * then asserts no internal command appears as commandName in any MDX frontmatter.
 *
 * @param contentDir - Directory containing generated MDX files
 * @param manifestPath - Path to commands.json
 */
export function checkGate(contentDir: string, manifestPath: string): GateResult {
  const errors: string[] = [];

  // If content dir doesn't exist, nothing to check — gate passes
  if (!fs.existsSync(contentDir)) {
    return { passed: true, errors: [], checkedCount: 0 };
  }

  // Read manifest
  let manifest: { commands: Array<{ name: string; visibility?: string }> };
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as typeof manifest;
  } catch (err) {
    return {
      passed: false,
      errors: [`Failed to read manifest: ${manifestPath} — ${err}`],
      checkedCount: 0,
    };
  }

  if (!manifest.commands || !Array.isArray(manifest.commands)) {
    return {
      passed: false,
      errors: [`Manifest missing .commands array: ${manifestPath}`],
      checkedCount: 0,
    };
  }

  // Build set of internal command names
  const internalCommands = new Set(
    manifest.commands
      .filter(c => c.visibility !== 'public')
      .map(c => c.name),
  );

  // Check each MDX file (skip index.mdx — it's a hand-written stub)
  const mdxFiles = fs.readdirSync(contentDir).filter(
    f => f.endsWith('.mdx') && f !== 'index.mdx',
  );

  for (const file of mdxFiles) {
    const raw = fs.readFileSync(path.join(contentDir, file), 'utf-8');
    const { data } = matter(raw);

    // commandName MUST be a string — non-string values bypass Set.has() silently
    if (typeof data['commandName'] !== 'string' || !data['commandName']) {
      errors.push(
        `MDX file '${file}' missing or non-string 'commandName' frontmatter field`,
      );
      continue;
    }

    if (internalCommands.has(data['commandName'] as string)) {
      errors.push(
        `Command '${data['commandName']}' is internal but found in public MDX file '${file}'`,
      );
    }
  }

  return { passed: errors.length === 0, errors, checkedCount: mdxFiles.length };
}

// ---- CLI wrapper (only runs when executed directly) ----

const isMainModule =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMainModule) {
  const result = checkGate(
    path.join(__dirname, '../content/mcp'),
    path.join(__dirname, '../../../mcp-server/manifest/commands.json'),
  );

  for (const err of result.errors) {
    console.error(`::error::${err}`);
  }

  if (result.passed) {
    console.log(
      `CI gate passed: ${result.checkedCount} command pages checked, no internal commands found.`,
    );
  }

  process.exit(result.passed ? 0 : 1);
}
