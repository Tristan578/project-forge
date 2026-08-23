import { describe, it, expect } from 'vitest';
import { TOOLTIP_DICTIONARY } from '../tooltipDictionary';

describe('TOOLTIP_DICTIONARY', () => {
  it('should be a non-empty record', () => {
    const keys = Object.keys(TOOLTIP_DICTIONARY);
    expect(keys.length).toBeGreaterThan(50);
  });

  it('should have non-empty string values', () => {
    for (const [key, value] of Object.entries(TOOLTIP_DICTIONARY)) {
      expect(typeof value, `${key} should be a string`).toBe('string');
      expect(value.length, `${key} should not be empty`).toBeGreaterThan(0);
    }
  });

  it('should include transform tooltips', () => {
    expect(TOOLTIP_DICTIONARY['position']).toBeDefined();
    expect(TOOLTIP_DICTIONARY['rotation']).toBeDefined();
    expect(TOOLTIP_DICTIONARY['scale']).toBeDefined();
  });

  it('should include material tooltips', () => {
    expect(TOOLTIP_DICTIONARY['metallic']).toBeDefined();
    expect(TOOLTIP_DICTIONARY['roughness']).toBeDefined();
    expect(TOOLTIP_DICTIONARY['baseColor']).toBeDefined();
  });

  it('should include physics tooltips', () => {
    expect(TOOLTIP_DICTIONARY['restitution']).toBeDefined();
    expect(TOOLTIP_DICTIONARY['friction']).toBeDefined();
    expect(TOOLTIP_DICTIONARY['bodyType']).toBeDefined();
  });

  it('should include audio tooltips', () => {
    expect(TOOLTIP_DICTIONARY['audioVolume']).toBeDefined();
    expect(TOOLTIP_DICTIONARY['audioSpatial']).toBeDefined();
  });

  it('should include game component tooltips', () => {
    expect(TOOLTIP_DICTIONARY['characterController']).toBeDefined();
    expect(TOOLTIP_DICTIONARY['health']).toBeDefined();
    expect(TOOLTIP_DICTIONARY['collectible']).toBeDefined();
  });

  it('should include lighting tooltips', () => {
    expect(TOOLTIP_DICTIONARY['intensity']).toBeDefined();
    expect(TOOLTIP_DICTIONARY['range']).toBeDefined();
    expect(TOOLTIP_DICTIONARY['lightShadows']).toBeDefined();
  });

  /**
   * A tooltip is read in a hover, at the size of a hover. `gcJumpHeight` had
   * grown to a 43-word two-sentence paragraph explaining the 2D/3D divergence —
   * more text than the panel it annotates, which is where a reader stops reading
   * tooltips at all (PF-1228). The ceiling is deliberately loose: it exists to
   * catch the next paragraph, not to police wording. Longest entry today is 29
   * words, so a regrowth past 30 is a real change, not drift.
   */
  it('should keep every tooltip short enough to read in a hover', () => {
    const LIMIT = 30;
    const tooLong = Object.entries(TOOLTIP_DICTIONARY)
      .map(([key, value]) => [key, value.trim().split(/\s+/).length] as const)
      .filter(([, words]) => words > LIMIT);
    expect(
      tooLong,
      `tooltips over ${LIMIT} words — move the detail into the panel or the docs`,
    ).toEqual([]);
  });

  it('tooltip values should be user-friendly (no raw code)', () => {
    for (const [key, value] of Object.entries(TOOLTIP_DICTIONARY)) {
      // Tooltips should not contain code-like constructs
      expect(value, `${key} should not contain code`).not.toMatch(/function\s*\(/);
      expect(value, `${key} should not contain code`).not.toMatch(/=>/);
    }
  });
});
