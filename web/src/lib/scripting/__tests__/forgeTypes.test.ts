import { describe, it, expect } from 'vitest';
import { FORGE_TYPE_DEFINITIONS } from '../forgeTypes';

/**
 * FORGE_TYPE_DEFINITIONS is fed verbatim to Monaco as an ambient `.d.ts` for
 * script autocomplete. If the declaration string is malformed (e.g. an
 * unbalanced brace from a namespace that was never closed), Monaco silently
 * drops ALL forge.* autocomplete — a regression that unit tests on the runtime
 * API would never catch. These tests guard the string's structural integrity.
 */
describe('FORGE_TYPE_DEFINITIONS', () => {
  it('declares the forge namespace', () => {
    expect(FORGE_TYPE_DEFINITIONS).toContain('declare namespace forge');
  });

  it('has balanced braces (catches an unclosed namespace)', () => {
    const open = (FORGE_TYPE_DEFINITIONS.match(/\{/g) ?? []).length;
    const close = (FORGE_TYPE_DEFINITIONS.match(/\}/g) ?? []).length;
    expect(open).toBe(close);
  });

  describe('game namespace', () => {
    it('declares the game namespace', () => {
      expect(FORGE_TYPE_DEFINITIONS).toContain('namespace game');
    });

    it('declares win(), setScore(), getScore() and onWin()', () => {
      expect(FORGE_TYPE_DEFINITIONS).toMatch(/function win\(\)\s*:\s*void/);
      expect(FORGE_TYPE_DEFINITIONS).toMatch(/function setScore\(score:\s*number\)\s*:\s*void/);
      expect(FORGE_TYPE_DEFINITIONS).toMatch(/function getScore\(\)\s*:\s*number/);
      expect(FORGE_TYPE_DEFINITIONS).toMatch(/function onWin\(callback:\s*\(\)\s*=>\s*void\)\s*:\s*void/);
    });
  });

  it('still exposes sibling namespaces after the game namespace', () => {
    // Regression guard: the game namespace was added between leaderboard and
    // i18n. A missing closing brace previously swallowed these siblings.
    expect(FORGE_TYPE_DEFINITIONS).toContain('namespace leaderboard');
    expect(FORGE_TYPE_DEFINITIONS).toContain('namespace i18n');
  });
});
