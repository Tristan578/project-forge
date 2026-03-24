import { describe, it, expect } from 'vitest';
import {
  PALETTES,
  getPalette,
  validateCustomPalette,
  type PaletteId,
} from '../palettes';

describe('palettes', () => {
  describe('PALETTES registry', () => {
    it('should contain all 9 preset palettes', () => {
      const ids: PaletteId[] = [
        'pico-8', 'db16', 'db32', 'endesga-32', 'endesga-64',
        'nes', 'game-boy', 'cga', 'custom',
      ];
      for (const id of ids) {
        expect(PALETTES[id]).not.toBeUndefined();
      }
    });

    it('pico-8 should have exactly 16 colors', () => {
      expect(PALETTES['pico-8'].colors).toHaveLength(16);
    });

    it('db16 should have exactly 16 colors', () => {
      expect(PALETTES['db16'].colors).toHaveLength(16);
    });

    it('db32 should have exactly 32 colors', () => {
      expect(PALETTES['db32'].colors).toHaveLength(32);
    });

    it('endesga-32 should have exactly 32 colors', () => {
      expect(PALETTES['endesga-32'].colors).toHaveLength(32);
    });

    it('endesga-64 should have exactly 64 colors', () => {
      expect(PALETTES['endesga-64'].colors).toHaveLength(64);
    });

    it('nes should have exactly 54 colors', () => {
      expect(PALETTES['nes'].colors).toHaveLength(54);
    });

    it('game-boy should have exactly 4 colors', () => {
      expect(PALETTES['game-boy'].colors).toHaveLength(4);
    });

    it('cga should have exactly 16 colors', () => {
      expect(PALETTES['cga'].colors).toHaveLength(16);
    });

    it('custom should have 0 colors (placeholder)', () => {
      expect(PALETTES['custom'].colors).toHaveLength(0);
    });

    it('all preset colors should be valid 6-digit hex strings', () => {
      const hexRegex = /^#[0-9a-fA-F]{6}$/;
      for (const [id, palette] of Object.entries(PALETTES)) {
        if (id === 'custom') continue;
        for (const color of palette.colors) {
          expect(color).toMatch(hexRegex);
        }
      }
    });

    it('each palette should have a name and id', () => {
      for (const [id, palette] of Object.entries(PALETTES)) {
        expect(palette.id).toBe(id);
        expect(palette.name.length).toBeGreaterThan(0);
      }
    });

    it('should have exactly 9 palettes total', () => {
      expect(Object.keys(PALETTES)).toHaveLength(9);
    });
  });

  describe('getPalette', () => {
    it('should return preset palette by id', () => {
      const palette = getPalette('pico-8');
      expect(palette).not.toBeUndefined();
      expect(palette!.colors).toHaveLength(16);
    });

    it('should return undefined for unknown id', () => {
      expect(getPalette('nonexistent' as PaletteId)).toBeUndefined();
    });

    it('should return correct name for db32', () => {
      const palette = getPalette('db32');
      expect(palette!.name).toBe('DawnBringer 32');
    });
  });

  describe('validateCustomPalette', () => {
    it('should accept valid hex color array with 2-256 colors', () => {
      expect(validateCustomPalette(['#ff0000', '#00ff00'])).toEqual({ valid: true });
    });

    it('should reject fewer than 2 colors', () => {
      const result = validateCustomPalette(['#ff0000']);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('2');
    });

    it('should reject more than 256 colors', () => {
      const colors = Array.from({ length: 257 }, (_, i) =>
        `#${i.toString(16).padStart(6, '0')}`
      );
      const result = validateCustomPalette(colors);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('256');
    });

    it('should reject invalid hex strings', () => {
      const result = validateCustomPalette(['#ff0000', 'not-a-color']);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('hex');
    });

    it('should reject empty array', () => {
      const result = validateCustomPalette([]);
      expect(result.valid).toBe(false);
    });

    it('should accept exactly 256 colors', () => {
      const colors = Array.from({ length: 256 }, (_, i) =>
        `#${i.toString(16).padStart(6, '0')}`
      );
      const result = validateCustomPalette(colors);
      expect(result.valid).toBe(true);
    });

    it('should accept exactly 2 colors', () => {
      const result = validateCustomPalette(['#000000', '#ffffff']);
      expect(result.valid).toBe(true);
    });

    it('should reject 3-digit hex', () => {
      const result = validateCustomPalette(['#fff', '#000']);
      expect(result.valid).toBe(false);
    });
  });
});
