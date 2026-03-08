import { describe, it, expect } from 'vitest';
import { PALETTES, getPalette, validateCustomPalette, type PaletteId } from '../palettes';

describe('palettes', () => {
  describe('PALETTES', () => {
    it('should have 9 preset palettes', () => {
      const ids = Object.keys(PALETTES);
      expect(ids).toHaveLength(9);
    });

    it('should include all expected palette IDs', () => {
      const expected: PaletteId[] = [
        'pico-8', 'db16', 'db32', 'endesga-32', 'endesga-64',
        'nes', 'game-boy', 'cga', 'custom',
      ];
      expected.forEach((id) => {
        expect(PALETTES).toHaveProperty(id);
      });
    });

    it('pico-8 should have 16 colors', () => {
      expect(PALETTES['pico-8'].colors).toHaveLength(16);
    });

    it('db16 should have 16 colors', () => {
      expect(PALETTES['db16'].colors).toHaveLength(16);
    });

    it('db32 should have 32 colors', () => {
      expect(PALETTES['db32'].colors).toHaveLength(32);
    });

    it('endesga-32 should have 32 colors', () => {
      expect(PALETTES['endesga-32'].colors).toHaveLength(32);
    });

    it('endesga-64 should have 64 colors', () => {
      expect(PALETTES['endesga-64'].colors).toHaveLength(64);
    });

    it('nes should have 54 colors', () => {
      expect(PALETTES['nes'].colors).toHaveLength(54);
    });

    it('game-boy should have 4 colors', () => {
      expect(PALETTES['game-boy'].colors).toHaveLength(4);
    });

    it('cga should have 16 colors', () => {
      expect(PALETTES['cga'].colors).toHaveLength(16);
    });

    it('custom should have 0 colors', () => {
      expect(PALETTES['custom'].colors).toHaveLength(0);
    });

    it('all colors should be valid hex strings', () => {
      const hexRegex = /^#[0-9a-fA-F]{6}$/;
      Object.values(PALETTES).forEach((palette) => {
        palette.colors.forEach((color) => {
          expect(color).toMatch(hexRegex);
        });
      });
    });
  });

  describe('getPalette', () => {
    it('should return palette for valid ID', () => {
      const palette = getPalette('pico-8');
      expect(palette).toBeDefined();
      expect(palette!.name).toBe('Pico-8');
    });

    it('should return undefined for invalid ID', () => {
      const palette = getPalette('nonexistent' as PaletteId);
      expect(palette).toBeUndefined();
    });
  });

  describe('validateCustomPalette', () => {
    it('should accept valid hex colors', () => {
      const result = validateCustomPalette(['#ff0000', '#00ff00', '#0000ff']);
      expect(result.valid).toBe(true);
    });

    it('should reject palette with fewer than 2 colors', () => {
      const result = validateCustomPalette(['#ff0000']);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('2');
    });

    it('should reject invalid hex format', () => {
      const result = validateCustomPalette(['#ff0000', 'not-hex', '#0000ff']);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('hex');
    });
  });
});
