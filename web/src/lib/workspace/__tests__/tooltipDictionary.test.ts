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
    expect(typeof TOOLTIP_DICTIONARY['position']).toBe('string');
    expect(typeof TOOLTIP_DICTIONARY['rotation']).toBe('string');
    expect(typeof TOOLTIP_DICTIONARY['scale']).toBe('string');
  });

  it('should include material tooltips', () => {
    expect(typeof TOOLTIP_DICTIONARY['metallic']).toBe('string');
    expect(typeof TOOLTIP_DICTIONARY['roughness']).toBe('string');
    expect(typeof TOOLTIP_DICTIONARY['baseColor']).toBe('string');
  });

  it('should include physics tooltips', () => {
    expect(typeof TOOLTIP_DICTIONARY['restitution']).toBe('string');
    expect(typeof TOOLTIP_DICTIONARY['friction']).toBe('string');
    expect(typeof TOOLTIP_DICTIONARY['bodyType']).toBe('string');
  });

  it('should include audio tooltips', () => {
    expect(typeof TOOLTIP_DICTIONARY['audioVolume']).toBe('string');
    expect(typeof TOOLTIP_DICTIONARY['audioSpatial']).toBe('string');
  });

  it('should include game component tooltips', () => {
    expect(typeof TOOLTIP_DICTIONARY['characterController']).toBe('string');
    expect(typeof TOOLTIP_DICTIONARY['health']).toBe('string');
    expect(typeof TOOLTIP_DICTIONARY['collectible']).toBe('string');
  });

  it('should include lighting tooltips', () => {
    expect(typeof TOOLTIP_DICTIONARY['intensity']).toBe('string');
    expect(typeof TOOLTIP_DICTIONARY['range']).toBe('string');
    expect(typeof TOOLTIP_DICTIONARY['lightShadows']).toBe('string');
  });

  it('tooltip values should be user-friendly (no raw code)', () => {
    for (const [key, value] of Object.entries(TOOLTIP_DICTIONARY)) {
      // Tooltips should not contain code-like constructs
      expect(value, `${key} should not contain code`).not.toMatch(/function\s*\(/);
      expect(value, `${key} should not contain code`).not.toMatch(/=>/);
    }
  });
});
