/** Guards published behavior counts and examples against the live component registry. */
import { readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GAME_COMPONENT_TYPES } from '@/stores/slices/types';

/**
 * Docs-accuracy regression (#9050 / PF-1030).
 *
 * The number of "drag-and-drop behaviors" advertised in prose is the count of
 * registered game components — `GAME_COMPONENT_TYPES` in
 * `web/src/stores/slices/types.ts`, which mirrors the engine's
 * `GameComponentData` enum (`engine/src/core/game_components.rs`). That claim
 * appears as a hard-coded literal in the marketing copy, so it silently rots
 * when a component is added or removed (it read "12" while 13 existed, and named
 * two examples — "Inventory", "NPC" — that are not components at all). This test
 * fails on the next drift instead of letting the copy go stale again.
 *
 * The count is asserted against the live `GAME_COMPONENT_TYPES.length`, never a
 * second hard-coded number, so adding a 14th component turns exactly one of the
 * two knobs (source of truth vs. copy) and the mismatch surfaces here.
 */

// The web vitest gate runs with cwd === web/; fall back to <cwd>/web when a
// developer invokes vitest from the repo root instead.
const CWD = process.cwd();
const WEB_DIR = basename(CWD) === 'web' ? CWD : join(CWD, 'web');
const REPO_ROOT = dirname(WEB_DIR);

const PAGE_PATH = join(WEB_DIR, 'src', 'app', 'use-cases', '[slug]', 'page.tsx');
const README_PATH = join(REPO_ROOT, 'README.md');

const EXPECTED_COUNT = GAME_COMPONENT_TYPES.length;

/** Compare component names across the snake_case registry and PascalCase prose. */
const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const REGISTRY = new Set(GAME_COMPONENT_TYPES.map(norm));

function claimedCounts(source: string): number[] {
  return [...source.matchAll(/(\d+)\s+drag-and-drop behaviors/gi)].map((m) => Number(m[1]));
}

/** Split a prose example list ("A, B, and C" / "A, B, C, etc.") into names. */
function exampleNames(list: string): string[] {
  return list
    .split(/,|\band\b/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !/^etc\.?$/i.test(s));
}

describe('use-cases drag-and-drop behavior count stays in sync with the registry', () => {
  const page = readFileSync(PAGE_PATH, 'utf8');
  const readme = readFileSync(README_PATH, 'utf8');

  it('the registry is nonempty and component names remain distinct after normalization', () => {
    expect(EXPECTED_COUNT).toBeGreaterThan(0);
    expect(REGISTRY.size).toBe(EXPECTED_COUNT);
  });

  it('every "N drag-and-drop behaviors" claim in the use-cases page matches the registry', () => {
    const counts = claimedCounts(page);
    expect(counts.length).toBeGreaterThan(0);
    for (const n of counts) {
      expect(n).toBe(EXPECTED_COUNT);
    }
  });

  it('every "N drag-and-drop behaviors" claim in the root README matches the registry', () => {
    const counts = claimedCounts(readme);
    expect(counts.length).toBeGreaterThan(0);
    for (const n of counts) {
      expect(n).toBe(EXPECTED_COUNT);
    }
  });

  it('the use-cases page names only real game components as examples', () => {
    const match = page.match(/drag-and-drop behaviors including ([^.]+)\./);
    expect(match, 'expected an "including ..." example list in page.tsx').not.toBeNull();
    const names = exampleNames(match![1]);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(REGISTRY.has(norm(name)), `"${name}" is not a registered game component`).toBe(true);
    }
  });

  it('the README names only real game components as examples', () => {
    // Accept both prose forms so a reword cannot silence the guard:
    //   "... behaviors (CharacterController, Health, ...)"  (parenthesised)
    //   "... behaviors including CharacterController, Health, and NPC."  (inline)
    const match = readme.match(/drag-and-drop behaviors (?:\(([^)]+)\)|including ([^.]+)\.)/);
    expect(match, 'expected a drag-and-drop behaviors example list in README.md').not.toBeNull();
    const names = exampleNames(match![1] ?? match![2]);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(REGISTRY.has(norm(name)), `"${name}" is not a registered game component`).toBe(true);
    }
  });
});
