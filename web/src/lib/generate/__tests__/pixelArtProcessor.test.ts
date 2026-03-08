import { describe, it, expect } from 'vitest';
import {
  nearestNeighborDownscale,
  medianCutQuantize,
  applyPaletteMapping,
  applyBayerDithering,
  processPixelArt,
  type PixelGrid,
} from '../pixelArtProcessor';
import type { RGB } from '../colorUtils';

function solidGrid(w: number, h: number, color: RGB): PixelGrid {
  return { width: w, height: h, pixels: Array(w * h).fill(color).map((c) => [...c] as RGB) };
}

function checkerGrid(w: number, h: number, c1: RGB, c2: RGB): PixelGrid {
  const pixels: RGB[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      pixels.push([...((x + y) % 2 === 0 ? c1 : c2)] as RGB);
    }
  }
  return { width: w, height: h, pixels };
}

describe('nearestNeighborDownscale', () => {
  it('should return identity for same size', () => {
    const grid = solidGrid(4, 4, [128, 64, 32]);
    const result = nearestNeighborDownscale(grid, 4, 4);
    expect(result.width).toBe(4);
    expect(result.height).toBe(4);
    expect(result.pixels[0]).toEqual([128, 64, 32]);
  });

  it('should downscale 4x4 to 2x2', () => {
    const grid = checkerGrid(4, 4, [255, 0, 0], [0, 255, 0]);
    const result = nearestNeighborDownscale(grid, 2, 2);
    expect(result.width).toBe(2);
    expect(result.height).toBe(2);
    expect(result.pixels.length).toBe(4);
  });

  it('should handle non-square dimensions', () => {
    const grid = solidGrid(8, 4, [100, 100, 100]);
    const result = nearestNeighborDownscale(grid, 4, 2);
    expect(result.width).toBe(4);
    expect(result.height).toBe(2);
    expect(result.pixels.length).toBe(8);
  });

  it('should upscale when target is larger', () => {
    const grid = solidGrid(2, 2, [50, 100, 150]);
    const result = nearestNeighborDownscale(grid, 4, 4);
    expect(result.width).toBe(4);
    expect(result.pixels.length).toBe(16);
    expect(result.pixels[0]).toEqual([50, 100, 150]);
  });
});

describe('medianCutQuantize', () => {
  it('should return empty for zero target', () => {
    expect(medianCutQuantize([[255, 0, 0]], 0)).toEqual([]);
  });

  it('should return empty for empty input', () => {
    expect(medianCutQuantize([], 4)).toEqual([]);
  });

  it('should return all colors when fewer than target', () => {
    const colors: RGB[] = [[255, 0, 0], [0, 255, 0]];
    const result = medianCutQuantize(colors, 4);
    expect(result.length).toBe(2);
  });

  it('should reduce to target count', () => {
    const colors: RGB[] = [];
    for (let i = 0; i < 100; i++) {
      colors.push([i * 2, i, 255 - i] as RGB);
    }
    const result = medianCutQuantize(colors, 4);
    expect(result.length).toBe(4);
  });

  it('should deduplicate identical colors', () => {
    const colors: RGB[] = Array(50).fill(null).map(() => [128, 128, 128] as RGB);
    const result = medianCutQuantize(colors, 4);
    expect(result.length).toBe(1);
  });
});

describe('applyPaletteMapping', () => {
  it('should map exact colors to themselves', () => {
    const palette: RGB[] = [[255, 0, 0], [0, 255, 0], [0, 0, 255]];
    const grid = solidGrid(2, 2, [255, 0, 0]);
    const result = applyPaletteMapping(grid, palette);
    expect(result.pixels[0]).toEqual([255, 0, 0]);
  });

  it('should map to nearest palette color', () => {
    const palette: RGB[] = [[255, 0, 0], [0, 0, 255]];
    const grid = solidGrid(1, 1, [200, 10, 10]);
    const result = applyPaletteMapping(grid, palette);
    expect(result.pixels[0]).toEqual([255, 0, 0]);
  });

  it('should preserve grid dimensions', () => {
    const palette: RGB[] = [[0, 0, 0], [255, 255, 255]];
    const grid = solidGrid(3, 5, [128, 128, 128]);
    const result = applyPaletteMapping(grid, palette);
    expect(result.width).toBe(3);
    expect(result.height).toBe(5);
    expect(result.pixels.length).toBe(15);
  });
});

describe('applyBayerDithering', () => {
  it('should equal palette mapping at intensity 0', () => {
    const palette: RGB[] = [[0, 0, 0], [255, 255, 255]];
    const grid = solidGrid(4, 4, [128, 128, 128]);
    const noDither = applyPaletteMapping(grid, palette);
    const zeroDither = applyBayerDithering(grid, palette, 0, '4x4');
    expect(zeroDither.pixels).toEqual(noDither.pixels);
  });

  it('should produce varied output at high intensity', () => {
    const palette: RGB[] = [[0, 0, 0], [255, 255, 255]];
    const grid = solidGrid(8, 8, [128, 128, 128]);
    const result = applyBayerDithering(grid, palette, 1, '8x8');
    const hasBlack = result.pixels.some((p) => p[0] === 0);
    const hasWhite = result.pixels.some((p) => p[0] === 255);
    expect(hasBlack).toBe(true);
    expect(hasWhite).toBe(true);
  });

  it('should work with 4x4 matrix', () => {
    const palette: RGB[] = [[0, 0, 0], [255, 255, 255]];
    const grid = solidGrid(4, 4, [128, 128, 128]);
    const result = applyBayerDithering(grid, palette, 0.5, '4x4');
    expect(result.pixels.length).toBe(16);
  });

  it('should tile correctly across grid', () => {
    const palette: RGB[] = [[0, 0, 0], [128, 128, 128], [255, 255, 255]];
    const grid = solidGrid(16, 16, [100, 100, 100]);
    const result = applyBayerDithering(grid, palette, 0.8, '8x8');
    expect(result.pixels.length).toBe(256);
  });
});

describe('processPixelArt full pipeline', () => {
  it('should process with preset palette, no dither', () => {
    const grid = solidGrid(64, 64, [200, 50, 50]);
    const palette: RGB[] = [[255, 0, 0], [0, 0, 255], [0, 255, 0]];
    const result = processPixelArt(grid, {
      targetWidth: 16,
      targetHeight: 16,
      presetPalette: palette,
      dithering: 'none',
      ditheringIntensity: 0,
    });
    expect(result.width).toBe(16);
    expect(result.height).toBe(16);
    expect(result.pixels[0]).toEqual([255, 0, 0]);
  });

  it('should auto-quantize when no preset palette', () => {
    const pixels: RGB[] = [];
    for (let i = 0; i < 64 * 64; i++) {
      pixels.push([Math.floor(i / 16) % 256, (i * 3) % 256, (i * 7) % 256] as RGB);
    }
    const grid: PixelGrid = { width: 64, height: 64, pixels };
    const result = processPixelArt(grid, {
      targetWidth: 16,
      targetHeight: 16,
      paletteColors: 4,
      dithering: 'none',
      ditheringIntensity: 0,
    });
    expect(result.width).toBe(16);
    const uniqueColors = new Set(result.pixels.map((p) => p.join(',')));
    expect(uniqueColors.size).toBeLessThanOrEqual(4);
  });

  it('should apply dithering when specified', () => {
    const grid = solidGrid(32, 32, [128, 128, 128]);
    const palette: RGB[] = [[0, 0, 0], [255, 255, 255]];
    const result = processPixelArt(grid, {
      targetWidth: 8,
      targetHeight: 8,
      presetPalette: palette,
      dithering: 'bayer8x8',
      ditheringIntensity: 1.0,
    });
    expect(result.width).toBe(8);
    const hasBlack = result.pixels.some((p) => p[0] === 0);
    const hasWhite = result.pixels.some((p) => p[0] === 255);
    expect(hasBlack || hasWhite).toBe(true);
  });

  it('should skip dithering at zero intensity', () => {
    const grid = solidGrid(16, 16, [128, 128, 128]);
    const palette: RGB[] = [[0, 0, 0], [255, 255, 255]];
    const withDither = processPixelArt(grid, {
      targetWidth: 8,
      targetHeight: 8,
      presetPalette: palette,
      dithering: 'bayer4x4',
      ditheringIntensity: 0,
    });
    const noDither = processPixelArt(grid, {
      targetWidth: 8,
      targetHeight: 8,
      presetPalette: palette,
      dithering: 'none',
      ditheringIntensity: 0,
    });
    expect(withDither.pixels).toEqual(noDither.pixels);
  });

  it('should throw on zero target dimensions', () => {
    const grid = solidGrid(4, 4, [128, 128, 128]);
    expect(() => processPixelArt(grid, {
      targetWidth: 0,
      targetHeight: 4,
      dithering: 'none',
      ditheringIntensity: 0,
    })).toThrow('positive integers');
  });
});
