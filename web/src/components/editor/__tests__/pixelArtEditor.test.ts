/**
 * Tests for Pixel Art Editor utility functions.
 * Tests cover grid operations, color conversion, flood fill, and line drawing.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect } from 'vitest';
import {
  createGrid,
  cloneGrid,
  hexToRgba,
  rgbaToHex,
  colorsEqual,
  floodFill,
  bresenhamLine,
  type RGBA,
} from '../PixelArtEditor';

describe('createGrid', () => {
  it('should create a grid of the specified size', () => {
    const grid = createGrid(8);
    expect(grid).toHaveLength(8);
    expect(grid[0]).toHaveLength(8);
  });

  it('should initialize all pixels to transparent', () => {
    const grid = createGrid(4);
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        expect(grid[y][x]).toEqual([0, 0, 0, 0]);
      }
    }
  });
});

describe('cloneGrid', () => {
  it('should create a deep copy of the grid', () => {
    const grid = createGrid(4);
    grid[0][0] = [255, 0, 0, 255];
    const clone = cloneGrid(grid);
    expect(clone[0][0]).toEqual([255, 0, 0, 255]);

    // Modifying clone should not affect original
    clone[0][0] = [0, 255, 0, 255];
    expect(grid[0][0]).toEqual([255, 0, 0, 255]);
  });
});

describe('hexToRgba', () => {
  it('should convert hex to RGBA', () => {
    expect(hexToRgba('#ff0000')).toEqual([255, 0, 0, 255]);
    expect(hexToRgba('#00ff00')).toEqual([0, 255, 0, 255]);
    expect(hexToRgba('#0000ff')).toEqual([0, 0, 255, 255]);
    expect(hexToRgba('#000000')).toEqual([0, 0, 0, 255]);
    expect(hexToRgba('#ffffff')).toEqual([255, 255, 255, 255]);
  });

  it('should use custom alpha', () => {
    expect(hexToRgba('#ff0000', 128)).toEqual([255, 0, 0, 128]);
  });
});

describe('rgbaToHex', () => {
  it('should convert RGBA to hex (ignoring alpha)', () => {
    expect(rgbaToHex([255, 0, 0, 255])).toBe('#ff0000');
    expect(rgbaToHex([0, 255, 0, 128])).toBe('#00ff00');
    expect(rgbaToHex([0, 0, 0, 255])).toBe('#000000');
  });
});

describe('colorsEqual', () => {
  it('should return true for identical colors', () => {
    expect(colorsEqual([255, 0, 0, 255], [255, 0, 0, 255])).toBe(true);
    expect(colorsEqual([0, 0, 0, 0], [0, 0, 0, 0])).toBe(true);
  });

  it('should return false for different colors', () => {
    expect(colorsEqual([255, 0, 0, 255], [0, 255, 0, 255])).toBe(false);
    expect(colorsEqual([255, 0, 0, 255], [255, 0, 0, 128])).toBe(false);
  });
});

describe('floodFill', () => {
  it('should fill a connected region', () => {
    const grid = createGrid(4);
    const red: RGBA = [255, 0, 0, 255];
    const filled = floodFill(grid, 0, 0, red);

    // All transparent pixels should be filled
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        expect(filled[y][x]).toEqual(red);
      }
    }
  });

  it('should not fill across a boundary', () => {
    const grid = createGrid(4);
    const wall: RGBA = [0, 0, 0, 255];
    const fill: RGBA = [255, 0, 0, 255];

    // Create a vertical wall at x=2
    for (let y = 0; y < 4; y++) {
      grid[y][2] = [...wall];
    }

    const filled = floodFill(grid, 0, 0, fill);

    // Left side should be filled
    expect(filled[0][0]).toEqual(fill);
    expect(filled[0][1]).toEqual(fill);
    // Wall should be unchanged
    expect(filled[0][2]).toEqual(wall);
    // Right side should still be transparent
    expect(filled[0][3]).toEqual([0, 0, 0, 0]);
  });

  it('should not change grid when filling with same color', () => {
    const grid = createGrid(2);
    const red: RGBA = [255, 0, 0, 255];
    grid[0][0] = [...red];
    grid[0][1] = [...red];
    grid[1][0] = [...red];
    grid[1][1] = [...red];

    const result = floodFill(grid, 0, 0, red);
    expect(result[0][0]).toEqual(red);
  });

  it('should not modify the original grid', () => {
    const grid = createGrid(4);
    const red: RGBA = [255, 0, 0, 255];
    floodFill(grid, 0, 0, red);

    // Original should still be transparent
    expect(grid[0][0]).toEqual([0, 0, 0, 0]);
  });
});

describe('bresenhamLine', () => {
  it('should draw a horizontal line', () => {
    const points = bresenhamLine(0, 0, 3, 0);
    expect(points).toEqual([[0, 0], [1, 0], [2, 0], [3, 0]]);
  });

  it('should draw a vertical line', () => {
    const points = bresenhamLine(0, 0, 0, 3);
    expect(points).toEqual([[0, 0], [0, 1], [0, 2], [0, 3]]);
  });

  it('should draw a diagonal line', () => {
    const points = bresenhamLine(0, 0, 3, 3);
    expect(points).toHaveLength(4);
    expect(points[0]).toEqual([0, 0]);
    expect(points[3]).toEqual([3, 3]);
  });

  it('should draw a single point', () => {
    const points = bresenhamLine(2, 2, 2, 2);
    expect(points).toEqual([[2, 2]]);
  });

  it('should handle reversed direction', () => {
    const points = bresenhamLine(3, 0, 0, 0);
    expect(points).toHaveLength(4);
    expect(points[0]).toEqual([3, 0]);
    expect(points[3]).toEqual([0, 0]);
  });
});

// Note: gridToDataUrl requires a real canvas context (not available in jsdom).
// It is tested indirectly via integration/E2E tests.
