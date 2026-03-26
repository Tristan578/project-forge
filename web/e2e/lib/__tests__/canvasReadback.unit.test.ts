/**
 * Unit tests for the pure functions in canvasReadback.ts
 *
 * Tests isBlankFrame() without a browser. The captureCanvasFrame() function
 * requires a Playwright Page and is tested in the integration specs.
 */
import { describe, it, expect } from 'vitest';
import { isBlankFrame } from '../canvasReadback';

describe('isBlankFrame', () => {
  it('returns true for empty array', () => {
    expect(isBlankFrame([])).toBe(true);
  });

  it('returns true for all-zero pixel data (transparent black)', () => {
    // 4×4 image — all zeros = transparent black
    const allZero = new Uint8Array(64).fill(0);
    expect(isBlankFrame(allZero)).toBe(true);
  });

  it('returns false when a pixel has non-zero red channel', () => {
    const data = new Uint8Array(64).fill(0);
    data[0] = 128; // red > 0
    expect(isBlankFrame(data)).toBe(false);
  });

  it('returns false when a pixel has non-zero green channel', () => {
    const data = new Uint8Array(64).fill(0);
    data[1] = 200; // green > 0
    expect(isBlankFrame(data)).toBe(false);
  });

  it('returns false when a pixel has non-zero blue channel', () => {
    const data = new Uint8Array(64).fill(0);
    data[2] = 50; // blue > 0
    expect(isBlankFrame(data)).toBe(false);
  });

  it('returns false when a pixel has alpha > 10', () => {
    const data = new Uint8Array(64).fill(0);
    data[3] = 11; // alpha > 10 threshold
    expect(isBlankFrame(data)).toBe(false);
  });

  it('returns true when alpha is exactly at threshold (10)', () => {
    // alpha == 10 is at the boundary — still treated as blank
    const data = new Uint8Array(64).fill(0);
    data[3] = 10;
    expect(isBlankFrame(data)).toBe(true);
  });

  it('accepts plain number arrays as well as Uint8Arrays', () => {
    const nonBlank: number[] = [128, 0, 0, 255, ...new Array(60).fill(0)];
    expect(isBlankFrame(nonBlank)).toBe(false);

    const blank: number[] = new Array(64).fill(0);
    expect(isBlankFrame(blank)).toBe(true);
  });

  it('samples evenly across the array — a non-zero pixel at a sampled offset is detected', () => {
    // 256-byte array, sampleCount=64: stride = floor(256/64)*4 = 16
    // Samples at offsets 0, 16, 32, 48, ... 240.
    // Place a non-zero pixel at offset 240 (red channel) — a sampled position.
    const data = new Uint8Array(256).fill(0);
    data[240] = 100; // red channel at a sampled stride position
    expect(isBlankFrame(data)).toBe(false);
  });
});
