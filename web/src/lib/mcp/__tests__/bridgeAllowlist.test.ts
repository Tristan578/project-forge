import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

import manifestJson from '@/data/commands.json';
import commandIndex from '@/data/commandIndex.json';
import {
  bridgeVerdict,
  bridgeAllowedCommands,
  bridgeCategoryPartition,
  BRIDGE_ALLOWED_CATEGORIES,
  BRIDGE_DENIED_CATEGORIES,
} from '../bridgeAllowlist';

interface ManifestCommand {
  name: string;
  category: string;
  requiredScope: string;
}

const manifestCommands = (manifestJson as { commands: ManifestCommand[] }).commands;
const indexCommands = (commandIndex as { commands: ManifestCommand[] }).commands;

/**
 * `bridgeAllowlist` decides what a remote MCP agent may run inside the editor
 * tab. It used to import the whole 344 KB manifest to read three fields per
 * command, so every description and JSON parameter schema shipped to the
 * browser — ~205 KB minified — to answer a question about `name`, `category`
 * and `requiredScope` (#9954).
 *
 * Swapping the source of an ALLOWLIST is not a cosmetic change: an index that
 * silently lost a command would make it "unknown", and an index that gained a
 * command nobody classified would be the deny-list failure the module's own
 * header was written to prevent. So the equivalence is asserted directly,
 * against the canonical manifest, rather than assumed from the generator.
 */
describe('the slim command index is behaviourally identical to the manifest', () => {
  it('carries exactly the same command names', () => {
    expect(indexCommands.length).toBeGreaterThan(0);
    expect(indexCommands.map((c) => c.name).sort()).toEqual(
      manifestCommands.map((c) => c.name).sort(),
    );
  });

  it('gives every command the same verdict the manifest would', () => {
    // Recompute each verdict from the MANIFEST's own category and scope and
    // compare against the live function, which reads the index. Any drift in
    // either field on any command shows up here as a differing verdict.
    let checked = 0;
    for (const command of manifestCommands) {
      const denied = BRIDGE_DENIED_CATEGORIES.has(command.category);
      const unlisted = !BRIDGE_ALLOWED_CATEGORIES.has(command.category);
      const deniedScope =
        command.requiredScope === 'ai:generate' || command.requiredScope === 'project:manage';
      const expected = !(denied || unlisted || deniedScope);

      expect(bridgeVerdict(command.name).allowed, command.name).toBe(expected);
      checked += 1;
    }
    // A zero-length manifest would make every assertion above vacuous.
    expect(checked).toBe(manifestCommands.length);
    expect(checked).toBeGreaterThan(100);
  });

  it('still refuses a name that is in neither', () => {
    const verdict = bridgeVerdict('definitely_not_a_command');
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toMatch(/unknown command/i);
  });

  it('leaves no manifest category unclassified', () => {
    // The partition is computed from whatever `commands` was built from, so
    // this is also how a truncated index would announce itself.
    expect(bridgeCategoryPartition()).toEqual({
      unclassified: [],
      missingFromManifest: [],
    });
  });

  it('allows a non-empty set of commands', () => {
    expect(bridgeAllowedCommands().length).toBeGreaterThan(0);
  });
});

/**
 * THE BUNDLE GUARD.
 *
 * Nothing at runtime can see which JSON file this module imported — both
 * produce identical verdicts, which is the point of the tests above. So the
 * only thing standing between a refactor and 205 KB returning to the browser
 * is a source pin, and a containment check ("does the string appear") is not
 * one: it passes on a commented-out line and on an import added beside the
 * index rather than instead of it (lesson 16).
 *
 * This asserts on EXECUTABLE import lines: line-anchored, comment markers
 * excluded, counted rather than tested for membership.
 */
describe('bridgeAllowlist does not pull the full manifest into the client bundle', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'src/lib/mcp/bridgeAllowlist.ts'),
    'utf-8',
  );

  const executableImports = source
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('import ') && !line.startsWith('//'));

  it('reads the file it means to read', () => {
    // Without this, a bad path would make every assertion below pass on ''.
    expect(source).toContain('BRIDGE_ALLOWED_CATEGORIES');
    expect(executableImports.length).toBeGreaterThan(0);
  });

  it('has no executable import of the full manifest', () => {
    const manifestImports = executableImports.filter((line) =>
      line.includes('@/data/commands.json'),
    );
    expect(manifestImports).toEqual([]);
  });

  it('imports the slim index exactly once', () => {
    const indexImports = executableImports.filter((line) =>
      line.includes('@/data/commandIndex.json'),
    );
    expect(indexImports).toHaveLength(1);
  });
});
