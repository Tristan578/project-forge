/**
 * The two count claims in spawnforgeAgent.ts's doc comments are prose, not
 * code, so nothing recomputed them and both rotted: the filter-policy comment
 * read "(279 of 363)" and the approval-derivation comment read "260 of 351",
 * while the manifest holds 364 commands, the shared filter advertises 280 of
 * them, and `:write` covers 267 (#10056). The sibling `capabilityMatrix`
 * gate pins the same getChatTools() figure across the docs but never reached
 * this source file. These assertions derive every number from the manifest and
 * getChatTools() — the exact sources the comments describe — so a manifest
 * change that moves a count fails here instead of leaving the comment stale.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getChatTools } from '@/lib/chat/tools';
import manifest from '@/data/commands.json';

const SOURCE = readFileSync(join(__dirname, '..', 'spawnforgeAgent.ts'), 'utf8');

describe('spawnforgeAgent doc-comment command counts', () => {
  const commands = (manifest as { commands: { requiredScope: string }[] }).commands;
  const total = commands.length;
  // getChatTools() and getAgentTools() share one predicate; the filter-policy
  // comment describes that shared count.
  const advertised = getChatTools().length;
  const writeScoped = commands.filter((c) => c.requiredScope.endsWith(':write')).length;

  it('derives non-vacuous counts from code', () => {
    expect(total).toBeGreaterThan(0);
    expect(advertised).toBeGreaterThan(0);
    expect(writeScoped).toBeGreaterThan(0);
    expect(SOURCE.length).toBeGreaterThan(0);
  });

  it('the filter-policy comment quotes getChatTools() over the manifest total', () => {
    const m = SOURCE.match(/reduce tool count \((\d+) of (\d+)\)/);
    expect(m, 'the filter-policy comment lost its "(N of M)" tool-count claim').not.toBeNull();
    expect(Number(m![1]), 'advertised tool count in the comment is stale').toBe(advertised);
    expect(Number(m![2]), 'manifest total in the comment is stale').toBe(total);
  });

  it('the approval-derivation comment quotes the :write-scoped count over the total', () => {
    const m = SOURCE.match(/`:write` covers (\d+) of (\d+) commands/);
    expect(m, 'the approval-derivation comment lost its ":write covers N of M" claim').not.toBeNull();
    expect(Number(m![1]), ':write-scoped count in the comment is stale').toBe(writeScoped);
    expect(Number(m![2]), 'manifest total in the comment is stale').toBe(total);
  });
});
