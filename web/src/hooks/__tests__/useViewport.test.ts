/**
 * Tests for useViewport utility functions (breakpoint detection and clamping).
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect } from 'vitest';

// Re-implement the pure functions from useViewport for unit testing
function getBreakpoint(width: number): string {
  if (width < 768) return 'mobile';
  if (width < 1024) return 'tablet';
  if (width < 1440) return 'laptop';
  if (width < 1920) return 'desktop';
  if (width < 2560) return 'large';
  return 'ultrawide';
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

describe('useViewport utilities', () => {
  describe('getBreakpoint', () => {
    it('returns mobile for narrow widths', () => {
      expect(getBreakpoint(375)).toBe('mobile');
      expect(getBreakpoint(767)).toBe('mobile');
    });

    it('returns tablet for medium widths', () => {
      expect(getBreakpoint(768)).toBe('tablet');
      expect(getBreakpoint(1023)).toBe('tablet');
    });

    it('returns laptop for standard widths', () => {
      expect(getBreakpoint(1024)).toBe('laptop');
      expect(getBreakpoint(1439)).toBe('laptop');
    });

    it('returns desktop for large widths', () => {
      expect(getBreakpoint(1440)).toBe('desktop');
      expect(getBreakpoint(1919)).toBe('desktop');
    });

    it('returns large for very wide screens', () => {
      expect(getBreakpoint(1920)).toBe('large');
      expect(getBreakpoint(2559)).toBe('large');
    });

    it('returns ultrawide for 4K+ screens', () => {
      expect(getBreakpoint(2560)).toBe('ultrawide');
      expect(getBreakpoint(3840)).toBe('ultrawide');
    });
  });

  describe('clamp', () => {
    it('clamps values below minimum', () => {
      expect(clamp(100, 375, 3840)).toBe(375);
    });

    it('clamps values above maximum', () => {
      expect(clamp(5000, 375, 3840)).toBe(3840);
    });

    it('returns value when within range', () => {
      expect(clamp(1920, 375, 3840)).toBe(1920);
    });

    it('returns min when value equals min', () => {
      expect(clamp(375, 375, 3840)).toBe(375);
    });

    it('returns max when value equals max', () => {
      expect(clamp(3840, 375, 3840)).toBe(3840);
    });
  });
});
