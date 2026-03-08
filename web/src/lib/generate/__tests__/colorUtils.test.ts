import { describe, it, expect } from 'vitest';
import {
  hexToRgb,
  rgbToHex,
  rgbToLab,
  labDistance,
  findNearestColor,
  type RGB,
  type LAB,
} from '../colorUtils';

describe('colorUtils', () => {
  describe('hexToRgb', () => {
    it('should convert #000000 to [0,0,0]', () => {
      expect(hexToRgb('#000000')).toEqual([0, 0, 0]);
    });
    it('should convert #ffffff to [255,255,255]', () => {
      expect(hexToRgb('#ffffff')).toEqual([255, 255, 255]);
    });
    it('should convert #ff0000 to [255,0,0]', () => {
      expect(hexToRgb('#ff0000')).toEqual([255, 0, 0]);
    });
  });

  describe('rgbToHex', () => {
    it('should convert [0,0,0] to #000000', () => {
      expect(rgbToHex([0, 0, 0])).toBe('#000000');
    });
    it('should convert [255,255,255] to #ffffff', () => {
      expect(rgbToHex([255, 255, 255])).toBe('#ffffff');
    });
    it('roundtrip hex->rgb->hex', () => {
      expect(rgbToHex(hexToRgb('#ab5236'))).toBe('#ab5236');
    });
  });

  describe('rgbToLab', () => {
    it('should convert black to L*=0', () => {
      const lab = rgbToLab([0, 0, 0]);
      expect(lab[0]).toBeCloseTo(0, 0);
    });
    it('should convert white to L*≈100', () => {
      const lab = rgbToLab([255, 255, 255]);
      expect(lab[0]).toBeCloseTo(100, 0);
    });
    it('should convert pure red to positive a*', () => {
      const lab = rgbToLab([255, 0, 0]);
      expect(lab[1]).toBeGreaterThan(0);
    });
    it('should convert pure green to negative a*', () => {
      const lab = rgbToLab([0, 128, 0]);
      expect(lab[1]).toBeLessThan(0);
    });
  });

  describe('labDistance', () => {
    it('should return 0 for identical colors', () => {
      const lab: LAB = [50, 20, -10];
      expect(labDistance(lab, lab)).toBe(0);
    });
    it('should return positive for different colors', () => {
      const a: LAB = [50, 0, 0];
      const b: LAB = [60, 10, -5];
      expect(labDistance(a, b)).toBeGreaterThan(0);
    });
  });

  describe('findNearestColor', () => {
    it('should return exact match when present', () => {
      const palette: RGB[] = [[255, 0, 0], [0, 255, 0], [0, 0, 255]];
      expect(findNearestColor([255, 0, 0], palette)).toEqual([255, 0, 0]);
    });
    it('should find nearest by LAB distance', () => {
      const palette: RGB[] = [[255, 0, 0], [0, 0, 255]];
      expect(findNearestColor([255, 128, 0], palette)).toEqual([255, 0, 0]);
    });
    it('should handle single-color palette', () => {
      expect(findNearestColor([100, 200, 50], [[0, 0, 0]])).toEqual([0, 0, 0]);
    });
    it('should return input pixel for empty palette', () => {
      const pixel: RGB = [128, 64, 32];
      expect(findNearestColor(pixel, [])).toEqual([128, 64, 32]);
    });
  });
});
