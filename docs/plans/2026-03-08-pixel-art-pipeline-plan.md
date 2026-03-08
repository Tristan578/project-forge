# AI Pixel Art Pipeline — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement a complete AI pixel art generation pipeline with post-processing algorithms, 9 preset palettes, AI provider integration, API route, UI dialog, and MCP handlers — all with full test coverage (50+ tests).

**Architecture:** User provides prompt + settings → API route validates/deducts tokens → AI provider generates high-res image → post-processing pipeline (downscale → quantize → palette map → dither) → clean indexed pixel art PNG returned to client → stored as sprite asset.

**Tech Stack:** TypeScript, Next.js 16 API routes, Vitest, React/Zustand, existing auth/token/key infrastructure.

**Design Doc:** `docs/plans/2026-03-08-aseprite-bridge-design.md`

---

### Task 1: Preset Palette Definitions

**Files:**
- Create: `web/src/lib/generate/palettes.ts`
- Create: `web/src/lib/generate/__tests__/palettes.test.ts`

**Step 1: Write the failing tests**

```typescript
// web/src/lib/generate/__tests__/palettes.test.ts
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
        expect(PALETTES[id]).toBeDefined();
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
  });

  describe('getPalette', () => {
    it('should return preset palette by id', () => {
      const palette = getPalette('pico-8');
      expect(palette).toBeDefined();
      expect(palette!.colors).toHaveLength(16);
    });

    it('should return undefined for unknown id', () => {
      expect(getPalette('nonexistent' as PaletteId)).toBeUndefined();
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
      expect(result.error).toContain('invalid');
    });

    it('should reject empty array', () => {
      const result = validateCustomPalette([]);
      expect(result.valid).toBe(false);
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run src/lib/generate/__tests__/palettes.test.ts`
Expected: FAIL — module not found

**Step 3: Write the implementation**

```typescript
// web/src/lib/generate/palettes.ts
export type PaletteId =
  | 'pico-8' | 'db16' | 'db32' | 'endesga-32' | 'endesga-64'
  | 'nes' | 'game-boy' | 'cga' | 'custom';

export interface PaletteDefinition {
  id: PaletteId;
  name: string;
  colors: string[]; // hex '#RRGGBB'
}

export const PALETTES: Record<PaletteId, PaletteDefinition> = {
  'pico-8': {
    id: 'pico-8',
    name: 'PICO-8',
    colors: [
      '#000000', '#1d2b53', '#7e2553', '#008751',
      '#ab5236', '#5f574f', '#c2c3c7', '#fff1e8',
      '#ff004d', '#ffa300', '#ffec27', '#00e436',
      '#29adff', '#83769c', '#ff77a8', '#ffccaa',
    ],
  },
  'db16': {
    id: 'db16',
    name: 'DawnBringer 16',
    colors: [
      '#140c1c', '#442434', '#30346d', '#4e4a4e',
      '#854c30', '#346524', '#d04648', '#757161',
      '#597dce', '#d27d2c', '#8595a1', '#6daa2c',
      '#d2aa99', '#6dc2ca', '#dad45e', '#deeed6',
    ],
  },
  'db32': {
    id: 'db32',
    name: 'DawnBringer 32',
    colors: [
      '#000000', '#222034', '#45283c', '#663931',
      '#8f563b', '#df7126', '#d9a066', '#eec39a',
      '#fbf236', '#99e550', '#6abe30', '#37946e',
      '#4b692f', '#524b24', '#323c39', '#3f3f74',
      '#306082', '#5b6ee1', '#639bff', '#5fcde4',
      '#cbdbfc', '#ffffff', '#9badb7', '#847e87',
      '#696a6a', '#595652', '#76428a', '#ac3232',
      '#d95763', '#d77bba', '#8f974a', '#8a6f30',
    ],
  },
  'endesga-32': {
    id: 'endesga-32',
    name: 'ENDESGA 32',
    colors: [
      '#be4a2f', '#d77643', '#ead4aa', '#e4a672',
      '#b86f50', '#733e39', '#3e2731', '#a22633',
      '#e43b44', '#f77622', '#feae34', '#fee761',
      '#63c74d', '#3e8948', '#265c42', '#193c3e',
      '#124e89', '#0099db', '#2ce8f5', '#ffffff',
      '#c0cbdc', '#8b9bb4', '#5a6988', '#3a4466',
      '#262b44', '#181425', '#ff0044', '#68386c',
      '#b55088', '#f6757a', '#e8b796', '#c28569',
    ],
  },
  'endesga-64': {
    id: 'endesga-64',
    name: 'ENDESGA 64',
    colors: [
      '#ff0040', '#131313', '#1b1b1b', '#272727',
      '#3d3d3d', '#5d5d5d', '#858585', '#b4b4b4',
      '#ffffff', '#c7cfdd', '#92a1b9', '#657392',
      '#424c6e', '#2a2f4e', '#1a1932', '#0e071b',
      '#1c121c', '#391f21', '#5d2c28', '#8a4836',
      '#bf6f4a', '#e69c69', '#f6ca9f', '#f9e6cf',
      '#edab50', '#e07438', '#c64524', '#8e251d',
      '#ff5000', '#ed7614', '#ffa214', '#ffc825',
      '#ffeb57', '#d3fc7e', '#99e65f', '#5ac54f',
      '#33984b', '#1e6f50', '#134c4c', '#0c2e44',
      '#00396d', '#0069aa', '#0098dc', '#00cdf9',
      '#0cf1ff', '#94fdff', '#fdd2ed', '#f389f5',
      '#db3ffd', '#7a09fa', '#3003d9', '#0c0293',
      '#03193f', '#3b1443', '#622461', '#93388f',
      '#ca52c9', '#c85086', '#f68187', '#f5555d',
      '#ea323c', '#c42430', '#891e2b', '#571c27',
    ],
  },
  'nes': {
    id: 'nes',
    name: 'NES',
    colors: [
      '#7c7c7c', '#0000fc', '#0000bc', '#4428bc',
      '#940084', '#a80020', '#a81000', '#881400',
      '#503000', '#007800', '#006800', '#005800',
      '#004058', '#000000', '#000000', '#000000',
      '#bcbcbc', '#0078f8', '#0058f8', '#6844fc',
      '#d800cc', '#e40058', '#f83800', '#e45c10',
      '#ac7c00', '#00b800', '#00a800', '#00a844',
      '#008888', '#000000', '#000000', '#000000',
      '#f8f8f8', '#3cbcfc', '#6888fc', '#9878f8',
      '#f878f8', '#f85898', '#f87858', '#fca044',
      '#f8b800', '#b8f818', '#58d854', '#58f898',
      '#00e8d8', '#787878', '#000000', '#000000',
      '#fcfcfc', '#a4e4fc', '#b8b8f8', '#d8b8f8',
      '#f8b8f8', '#f8a4c0', '#f0d0b0', '#fce0a8',
    ],
  },
  'game-boy': {
    id: 'game-boy',
    name: 'Game Boy',
    colors: ['#0f380f', '#306230', '#8bac0f', '#9bbc0f'],
  },
  'cga': {
    id: 'cga',
    name: 'CGA',
    colors: [
      '#000000', '#0000aa', '#00aa00', '#00aaaa',
      '#aa0000', '#aa00aa', '#aa5500', '#aaaaaa',
      '#555555', '#5555ff', '#55ff55', '#55ffff',
      '#ff5555', '#ff55ff', '#ffff55', '#ffffff',
    ],
  },
  'custom': {
    id: 'custom',
    name: 'Custom',
    colors: [],
  },
};

export function getPalette(id: PaletteId): PaletteDefinition | undefined {
  return PALETTES[id];
}

export function validateCustomPalette(
  colors: string[]
): { valid: true } | { valid: false; error: string } {
  if (colors.length < 2) {
    return { valid: false, error: 'Custom palette must have at least 2 colors' };
  }
  if (colors.length > 256) {
    return { valid: false, error: 'Custom palette must have at most 256 colors' };
  }
  const hexRegex = /^#[0-9a-fA-F]{6}$/;
  for (const color of colors) {
    if (!hexRegex.test(color)) {
      return { valid: false, error: `Color "${color}" is invalid hex (expected #RRGGBB)` };
    }
  }
  return { valid: true };
}
```

**Step 4: Run tests to verify they pass**

Run: `cd web && npx vitest run src/lib/generate/__tests__/palettes.test.ts`
Expected: PASS (17 tests)

**Step 5: Commit**

```bash
git add web/src/lib/generate/palettes.ts web/src/lib/generate/__tests__/palettes.test.ts
git commit -m "feat(pixel-art): add 9 preset palette definitions with validation"
```

---

### Task 2: Color Space Utilities (RGB ↔ LAB)

**Files:**
- Create: `web/src/lib/generate/colorUtils.ts`
- Create: `web/src/lib/generate/__tests__/colorUtils.test.ts`

**Step 1: Write the failing tests**

```typescript
// web/src/lib/generate/__tests__/colorUtils.test.ts
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
      // orange should be nearer to red than blue
      expect(findNearestColor([255, 128, 0], palette)).toEqual([255, 0, 0]);
    });
    it('should handle single-color palette', () => {
      expect(findNearestColor([100, 200, 50], [[0, 0, 0]])).toEqual([0, 0, 0]);
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run src/lib/generate/__tests__/colorUtils.test.ts`
Expected: FAIL

**Step 3: Write the implementation**

```typescript
// web/src/lib/generate/colorUtils.ts
export type RGB = [number, number, number];
export type LAB = [number, number, number];

export function hexToRgb(hex: string): RGB {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return [r, g, b];
}

export function rgbToHex(rgb: RGB): string {
  return '#' + rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('');
}

// D65 illuminant reference white
const REF_X = 95.047;
const REF_Y = 100.0;
const REF_Z = 108.883;

function srgbToLinear(c: number): number {
  c /= 255;
  return c > 0.04045 ? Math.pow((c + 0.055) / 1.055, 2.4) : c / 12.92;
}

function labF(t: number): number {
  return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
}

export function rgbToLab(rgb: RGB): LAB {
  const r = srgbToLinear(rgb[0]);
  const g = srgbToLinear(rgb[1]);
  const b = srgbToLinear(rgb[2]);

  const x = (r * 0.4124564 + g * 0.3575761 + b * 0.1804375) * 100;
  const y = (r * 0.2126729 + g * 0.7151522 + b * 0.0721750) * 100;
  const z = (r * 0.0193339 + g * 0.1191920 + b * 0.9503041) * 100;

  const fx = labF(x / REF_X);
  const fy = labF(y / REF_Y);
  const fz = labF(z / REF_Z);

  const L = 116 * fy - 16;
  const a = 500 * (fx - fy);
  const bLab = 200 * (fy - fz);

  return [L, a, bLab];
}

export function labDistance(a: LAB, b: LAB): number {
  return Math.sqrt(
    (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2
  );
}

export function findNearestColor(pixel: RGB, palette: RGB[]): RGB {
  const pixelLab = rgbToLab(pixel);
  let bestDist = Infinity;
  let best = palette[0];
  for (const color of palette) {
    const dist = labDistance(pixelLab, rgbToLab(color));
    if (dist < bestDist) {
      bestDist = dist;
      best = color;
    }
  }
  return best;
}
```

**Step 4: Run tests**

Run: `cd web && npx vitest run src/lib/generate/__tests__/colorUtils.test.ts`
Expected: PASS (13 tests)

**Step 5: Commit**

```bash
git add web/src/lib/generate/colorUtils.ts web/src/lib/generate/__tests__/colorUtils.test.ts
git commit -m "feat(pixel-art): add RGB/LAB color space utilities for perceptual matching"
```

---

### Task 3: Pixel Art Post-Processing Algorithms

**Files:**
- Create: `web/src/lib/generate/pixelArtProcessor.ts`
- Create: `web/src/lib/generate/__tests__/pixelArtProcessor.test.ts`

**Step 1: Write the failing tests**

```typescript
// web/src/lib/generate/__tests__/pixelArtProcessor.test.ts
import { describe, it, expect } from 'vitest';
import {
  nearestNeighborDownscale,
  medianCutQuantize,
  applyPaletteMapping,
  applyBayerDithering,
  processPixelArt,
  type PixelGrid,
  type ProcessOptions,
} from '../pixelArtProcessor';
import type { RGB } from '../colorUtils';

// Helper: create a solid-color grid
function solidGrid(w: number, h: number, color: RGB): PixelGrid {
  return {
    width: w,
    height: h,
    pixels: Array.from({ length: w * h }, () => [...color] as RGB),
  };
}

// Helper: create a 2-color checkerboard
function checkerGrid(w: number, h: number, a: RGB, b: RGB): PixelGrid {
  const pixels: RGB[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      pixels.push((x + y) % 2 === 0 ? [...a] as RGB : [...b] as RGB);
    }
  }
  return { width: w, height: h, pixels };
}

describe('pixelArtProcessor', () => {
  describe('nearestNeighborDownscale', () => {
    it('should return identity when src and dst are same size', () => {
      const grid = solidGrid(4, 4, [255, 0, 0]);
      const result = nearestNeighborDownscale(grid, 4, 4);
      expect(result.width).toBe(4);
      expect(result.height).toBe(4);
      expect(result.pixels).toHaveLength(16);
      expect(result.pixels[0]).toEqual([255, 0, 0]);
    });

    it('should downscale 8x8 to 4x4', () => {
      const grid = solidGrid(8, 8, [0, 255, 0]);
      const result = nearestNeighborDownscale(grid, 4, 4);
      expect(result.width).toBe(4);
      expect(result.height).toBe(4);
      expect(result.pixels).toHaveLength(16);
      expect(result.pixels[0]).toEqual([0, 255, 0]);
    });

    it('should handle non-square downscale', () => {
      const grid = solidGrid(8, 4, [0, 0, 255]);
      const result = nearestNeighborDownscale(grid, 4, 2);
      expect(result.width).toBe(4);
      expect(result.height).toBe(2);
      expect(result.pixels).toHaveLength(8);
    });

    it('should preserve pattern on 2x reduction', () => {
      const grid = checkerGrid(4, 4, [255, 0, 0], [0, 0, 255]);
      const result = nearestNeighborDownscale(grid, 2, 2);
      expect(result.pixels).toHaveLength(4);
      // top-left of each 2x2 block is sampled
      expect(result.pixels[0]).toEqual([255, 0, 0]);
    });
  });

  describe('medianCutQuantize', () => {
    it('should return single color for n=1', () => {
      const grid = checkerGrid(2, 2, [255, 0, 0], [0, 0, 255]);
      const palette = medianCutQuantize(grid.pixels, 1);
      expect(palette).toHaveLength(1);
    });

    it('should return 2 colors for 2-color input with n=2', () => {
      const grid = checkerGrid(4, 4, [255, 0, 0], [0, 0, 255]);
      const palette = medianCutQuantize(grid.pixels, 2);
      expect(palette).toHaveLength(2);
    });

    it('should return n colors for n=16', () => {
      // gradient with many colors
      const pixels: RGB[] = Array.from({ length: 100 }, (_, i) => [
        Math.floor((i / 100) * 255),
        Math.floor(((100 - i) / 100) * 255),
        128,
      ] as RGB);
      const palette = medianCutQuantize(pixels, 16);
      expect(palette).toHaveLength(16);
    });

    it('should handle single-color input', () => {
      const grid = solidGrid(4, 4, [128, 64, 32]);
      const palette = medianCutQuantize(grid.pixels, 4);
      // all same color, so only 1 unique bucket
      expect(palette.length).toBeGreaterThanOrEqual(1);
      expect(palette.length).toBeLessThanOrEqual(4);
    });

    it('should not exceed requested color count', () => {
      const pixels: RGB[] = Array.from({ length: 256 }, (_, i) => [i, 255 - i, 128] as RGB);
      const palette = medianCutQuantize(pixels, 8);
      expect(palette.length).toBeLessThanOrEqual(8);
    });
  });

  describe('applyPaletteMapping', () => {
    it('should map exact colors unchanged', () => {
      const grid = solidGrid(2, 2, [255, 0, 0]);
      const palette: RGB[] = [[255, 0, 0], [0, 255, 0], [0, 0, 255]];
      const result = applyPaletteMapping(grid, palette);
      expect(result.pixels[0]).toEqual([255, 0, 0]);
    });

    it('should map to nearest palette color', () => {
      const grid = solidGrid(2, 2, [250, 5, 5]);
      const palette: RGB[] = [[255, 0, 0], [0, 0, 255]];
      const result = applyPaletteMapping(grid, palette);
      expect(result.pixels[0]).toEqual([255, 0, 0]);
    });

    it('should not mutate original grid', () => {
      const grid = solidGrid(2, 2, [128, 128, 128]);
      const palette: RGB[] = [[0, 0, 0], [255, 255, 255]];
      applyPaletteMapping(grid, palette);
      expect(grid.pixels[0]).toEqual([128, 128, 128]);
    });
  });

  describe('applyBayerDithering', () => {
    it('should return unchanged grid with intensity=0', () => {
      const grid = solidGrid(4, 4, [128, 128, 128]);
      const palette: RGB[] = [[0, 0, 0], [255, 255, 255]];
      const noDither = applyPaletteMapping(grid, palette);
      const withDither = applyBayerDithering(grid, palette, 0, '8x8');
      expect(withDither.pixels).toEqual(noDither.pixels);
    });

    it('should produce different output with intensity=1 on mid-gray', () => {
      const grid = solidGrid(8, 8, [128, 128, 128]);
      const palette: RGB[] = [[0, 0, 0], [255, 255, 255]];
      const result = applyBayerDithering(grid, palette, 1.0, '8x8');
      // dithered result should have a mix of black and white
      const hasBlack = result.pixels.some((p) => p[0] === 0);
      const hasWhite = result.pixels.some((p) => p[0] === 255);
      expect(hasBlack).toBe(true);
      expect(hasWhite).toBe(true);
    });

    it('should support 4x4 matrix', () => {
      const grid = solidGrid(4, 4, [128, 128, 128]);
      const palette: RGB[] = [[0, 0, 0], [255, 255, 255]];
      const result = applyBayerDithering(grid, palette, 0.5, '4x4');
      expect(result.pixels).toHaveLength(16);
    });

    it('should tile correctly across grid boundaries', () => {
      const grid = solidGrid(16, 16, [100, 100, 100]);
      const palette: RGB[] = [[0, 0, 0], [255, 255, 255]];
      const result = applyBayerDithering(grid, palette, 0.5, '8x8');
      // first 8x8 block should equal second 8x8 block (tiling)
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          expect(result.pixels[y * 16 + x]).toEqual(result.pixels[y * 16 + x + 8]);
        }
      }
    });
  });

  describe('processPixelArt (full pipeline)', () => {
    it('should downscale + quantize + map', () => {
      const grid = solidGrid(64, 64, [200, 50, 50]);
      const result = processPixelArt(grid, {
        targetWidth: 32,
        targetHeight: 32,
        paletteColors: 16,
        dithering: 'none',
        ditheringIntensity: 0,
      });
      expect(result.width).toBe(32);
      expect(result.height).toBe(32);
      expect(result.pixels).toHaveLength(32 * 32);
    });

    it('should use preset palette when provided', () => {
      const grid = solidGrid(16, 16, [255, 0, 77]); // close to PICO-8 #ff004d
      const preset: RGB[] = [[255, 0, 77], [0, 0, 0]];
      const result = processPixelArt(grid, {
        targetWidth: 16,
        targetHeight: 16,
        presetPalette: preset,
        dithering: 'none',
        ditheringIntensity: 0,
      });
      expect(result.pixels[0]).toEqual([255, 0, 77]);
    });

    it('should apply dithering when specified', () => {
      const grid = solidGrid(8, 8, [128, 128, 128]);
      const palette: RGB[] = [[0, 0, 0], [255, 255, 255]];
      const result = processPixelArt(grid, {
        targetWidth: 8,
        targetHeight: 8,
        presetPalette: palette,
        dithering: 'bayer8x8',
        ditheringIntensity: 1.0,
      });
      const unique = new Set(result.pixels.map((p) => p.join(',')));
      expect(unique.size).toBeGreaterThan(1);
    });

    it('should handle 1x1 output', () => {
      const grid = solidGrid(32, 32, [100, 200, 50]);
      const result = processPixelArt(grid, {
        targetWidth: 1,
        targetHeight: 1,
        paletteColors: 4,
        dithering: 'none',
        ditheringIntensity: 0,
      });
      expect(result.width).toBe(1);
      expect(result.height).toBe(1);
      expect(result.pixels).toHaveLength(1);
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run src/lib/generate/__tests__/pixelArtProcessor.test.ts`
Expected: FAIL

**Step 3: Write the implementation**

```typescript
// web/src/lib/generate/pixelArtProcessor.ts
import { findNearestColor, type RGB } from './colorUtils';

export interface PixelGrid {
  width: number;
  height: number;
  pixels: RGB[];
}

export interface ProcessOptions {
  targetWidth: number;
  targetHeight: number;
  paletteColors?: number;       // for auto-quantize (median cut)
  presetPalette?: RGB[];        // use this palette instead of quantizing
  dithering: 'none' | 'bayer4x4' | 'bayer8x8';
  ditheringIntensity: number;   // 0-1
}

// -- Nearest-Neighbor Downscale --

export function nearestNeighborDownscale(
  src: PixelGrid,
  dstW: number,
  dstH: number
): PixelGrid {
  const pixels: RGB[] = new Array(dstW * dstH);
  for (let ty = 0; ty < dstH; ty++) {
    for (let tx = 0; tx < dstW; tx++) {
      const sx = Math.floor(tx * src.width / dstW);
      const sy = Math.floor(ty * src.height / dstH);
      const srcIdx = sy * src.width + sx;
      pixels[ty * dstW + tx] = [...src.pixels[srcIdx]] as RGB;
    }
  }
  return { width: dstW, height: dstH, pixels };
}

// -- Median-Cut Quantization --

export function medianCutQuantize(pixels: RGB[], targetColors: number): RGB[] {
  if (targetColors <= 0) return [];
  if (pixels.length === 0) return [];

  // Deduplicate for efficiency
  const uniqueMap = new Map<string, RGB>();
  for (const p of pixels) {
    const key = p.join(',');
    if (!uniqueMap.has(key)) uniqueMap.set(key, p);
  }
  const unique = Array.from(uniqueMap.values());

  if (unique.length <= targetColors) {
    return unique.map((c) => [...c] as RGB);
  }

  // Recursive median cut
  const buckets: RGB[][] = [unique];

  while (buckets.length < targetColors) {
    // Find bucket with widest channel range
    let maxRange = -1;
    let maxIdx = 0;
    for (let i = 0; i < buckets.length; i++) {
      const range = channelRange(buckets[i]);
      if (range.range > maxRange) {
        maxRange = range.range;
        maxIdx = i;
      }
    }
    if (maxRange === 0) break; // can't split further

    const bucket = buckets[maxIdx];
    const { channel } = channelRange(bucket);

    // Sort by widest channel and split at median
    bucket.sort((a, b) => a[channel] - b[channel]);
    const mid = Math.floor(bucket.length / 2);
    const left = bucket.slice(0, mid);
    const right = bucket.slice(mid);

    if (left.length === 0 || right.length === 0) break;

    buckets.splice(maxIdx, 1, left, right);
  }

  // Average each bucket
  return buckets.map((bucket) => {
    const avg: RGB = [0, 0, 0];
    for (const c of bucket) {
      avg[0] += c[0];
      avg[1] += c[1];
      avg[2] += c[2];
    }
    return [
      Math.round(avg[0] / bucket.length),
      Math.round(avg[1] / bucket.length),
      Math.round(avg[2] / bucket.length),
    ] as RGB;
  });
}

function channelRange(pixels: RGB[]): { channel: 0 | 1 | 2; range: number } {
  let bestChannel: 0 | 1 | 2 = 0;
  let bestRange = 0;
  for (const ch of [0, 1, 2] as const) {
    let min = 255, max = 0;
    for (const p of pixels) {
      if (p[ch] < min) min = p[ch];
      if (p[ch] > max) max = p[ch];
    }
    const range = max - min;
    if (range > bestRange) {
      bestRange = range;
      bestChannel = ch;
    }
  }
  return { channel: bestChannel, range: bestRange };
}

// -- Palette Mapping (LAB distance) --

export function applyPaletteMapping(grid: PixelGrid, palette: RGB[]): PixelGrid {
  const pixels = grid.pixels.map((p) => findNearestColor(p, palette));
  return { width: grid.width, height: grid.height, pixels };
}

// -- Bayer Dithering --

const BAYER_4X4 = [
  [ 0,  8,  2, 10],
  [12,  4, 14,  6],
  [ 3, 11,  1,  9],
  [15,  7, 13,  5],
];

const BAYER_8X8 = [
  [ 0, 32,  8, 40,  2, 34, 10, 42],
  [48, 16, 56, 24, 50, 18, 58, 26],
  [12, 44,  4, 36, 14, 46,  6, 38],
  [60, 28, 52, 20, 62, 30, 54, 22],
  [ 3, 35, 11, 43,  1, 33,  9, 41],
  [51, 19, 59, 27, 49, 17, 57, 25],
  [15, 47,  7, 39, 13, 45,  5, 37],
  [63, 31, 55, 23, 61, 29, 53, 21],
];

function getBayerMatrix(type: 'bayer4x4' | 'bayer8x8'): { matrix: number[][]; size: number; maxVal: number } {
  if (type === 'bayer4x4') return { matrix: BAYER_4X4, size: 4, maxVal: 16 };
  return { matrix: BAYER_8X8, size: 8, maxVal: 64 };
}

// Exported as '4x4'|'8x8' shorthand for internal use from tests
type DitherSize = '4x4' | '8x8';

export function applyBayerDithering(
  grid: PixelGrid,
  palette: RGB[],
  intensity: number,
  matrixType: DitherSize
): PixelGrid {
  if (intensity === 0) {
    return applyPaletteMapping(grid, palette);
  }

  const type = matrixType === '4x4' ? 'bayer4x4' : 'bayer8x8';
  const { matrix, size, maxVal } = getBayerMatrix(type);
  const spread = intensity * 64; // max dither spread

  const pixels: RGB[] = new Array(grid.width * grid.height);
  for (let y = 0; y < grid.height; y++) {
    for (let x = 0; x < grid.width; x++) {
      const idx = y * grid.width + x;
      const src = grid.pixels[idx];
      const threshold = (matrix[y % size][x % size] / maxVal - 0.5) * spread;
      const dithered: RGB = [
        Math.max(0, Math.min(255, src[0] + threshold)),
        Math.max(0, Math.min(255, src[1] + threshold)),
        Math.max(0, Math.min(255, src[2] + threshold)),
      ];
      pixels[idx] = findNearestColor(dithered, palette);
    }
  }
  return { width: grid.width, height: grid.height, pixels };
}

// -- Full Pipeline --

export function processPixelArt(src: PixelGrid, opts: ProcessOptions): PixelGrid {
  // 1. Downscale
  const downscaled = nearestNeighborDownscale(src, opts.targetWidth, opts.targetHeight);

  // 2. Determine palette
  let palette: RGB[];
  if (opts.presetPalette) {
    palette = opts.presetPalette;
  } else {
    const numColors = opts.paletteColors ?? 16;
    palette = medianCutQuantize(downscaled.pixels, numColors);
  }

  // 3. Apply dithering + palette mapping
  if (opts.dithering === 'none' || opts.ditheringIntensity === 0) {
    return applyPaletteMapping(downscaled, palette);
  }

  const matrixType: DitherSize = opts.dithering === 'bayer4x4' ? '4x4' : '8x8';
  return applyBayerDithering(downscaled, palette, opts.ditheringIntensity, matrixType);
}
```

**Step 4: Run tests**

Run: `cd web && npx vitest run src/lib/generate/__tests__/pixelArtProcessor.test.ts`
Expected: PASS (18 tests)

**Step 5: Commit**

```bash
git add web/src/lib/generate/pixelArtProcessor.ts web/src/lib/generate/__tests__/pixelArtProcessor.test.ts
git commit -m "feat(pixel-art): add post-processing pipeline (downscale, quantize, dither)"
```

---

### Task 4: Pixel Art AI Client

**Files:**
- Create: `web/src/lib/generate/pixelArtClient.ts`
- Create: `web/src/lib/generate/__tests__/pixelArtClient.test.ts`

**Step 1: Write the failing tests**

```typescript
// web/src/lib/generate/__tests__/pixelArtClient.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PixelArtClient, buildPixelArtPrompt, type PixelArtStyle } from '../pixelArtClient';

describe('pixelArtClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  describe('buildPixelArtPrompt', () => {
    it('should include pixel art style keywords', () => {
      const prompt = buildPixelArtPrompt('a knight', 'character');
      expect(prompt).toContain('pixel art');
      expect(prompt).toContain('knight');
    });

    it('should include character-specific terms for character style', () => {
      const prompt = buildPixelArtPrompt('a warrior', 'character');
      expect(prompt).toContain('sprite');
    });

    it('should include tile-specific terms for tile style', () => {
      const prompt = buildPixelArtPrompt('grass', 'tile');
      expect(prompt).toContain('tileable');
    });

    it('should include prop-specific terms for prop style', () => {
      const prompt = buildPixelArtPrompt('sword', 'prop');
      expect(prompt).toContain('game item');
    });

    it('should include icon-specific terms for icon style', () => {
      const prompt = buildPixelArtPrompt('heart', 'icon');
      expect(prompt).toContain('icon');
    });

    it('should include environment terms for environment style', () => {
      const prompt = buildPixelArtPrompt('forest', 'environment');
      expect(prompt).toContain('background');
    });
  });

  describe('PixelArtClient', () => {
    it('should call DALL-E endpoint for openai provider', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          data: [{ b64_json: 'base64data' }],
        }),
      } as Response);

      const client = new PixelArtClient('test-key', 'openai');
      const result = await client.generate({
        prompt: 'a knight',
        style: 'character',
        size: 1024,
      });

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('openai.com'),
        expect.objectContaining({ method: 'POST' })
      );
      expect(result.base64).toBe('base64data');
    });

    it('should call Replicate endpoint for replicate provider', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          id: 'pred-123',
          status: 'starting',
        }),
      } as Response);

      const client = new PixelArtClient('test-key', 'replicate');
      const result = await client.generate({
        prompt: 'a sword',
        style: 'prop',
        size: 1024,
      });

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('replicate.com'),
        expect.objectContaining({ method: 'POST' })
      );
      expect(result.predictionId).toBe('pred-123');
      expect(result.status).toBe('starting');
    });

    it('should throw on API error', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 429,
        text: () => Promise.resolve('Rate limited'),
      } as Response);

      const client = new PixelArtClient('test-key', 'openai');
      await expect(client.generate({
        prompt: 'test',
        style: 'character',
        size: 1024,
      })).rejects.toThrow('429');
    });

    it('should include pixel art prompt enhancement', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: [{ b64_json: 'x' }] }),
      } as Response);

      const client = new PixelArtClient('test-key', 'openai');
      await client.generate({ prompt: 'a cat', style: 'character', size: 512 });

      const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
      expect(body.prompt).toContain('pixel art');
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run src/lib/generate/__tests__/pixelArtClient.test.ts`
Expected: FAIL

**Step 3: Write the implementation**

```typescript
// web/src/lib/generate/pixelArtClient.ts

export type PixelArtStyle = 'character' | 'prop' | 'tile' | 'icon' | 'environment';
export type PixelArtProvider = 'openai' | 'replicate';

interface GenerateParams {
  prompt: string;
  style: PixelArtStyle;
  size: 512 | 1024;
  referenceImage?: string; // base64
}

interface OpenAIResult {
  base64: string;
}

interface ReplicateResult {
  predictionId: string;
  status: string;
}

export type GenerateResult = (OpenAIResult & { predictionId?: undefined; status?: undefined })
  | (ReplicateResult & { base64?: undefined });

const STYLE_MODIFIERS: Record<PixelArtStyle, string> = {
  character: 'game character sprite, front-facing, clean silhouette, transparent background',
  prop: 'game item, game prop, centered, clean edges, transparent background',
  tile: 'tileable seamless texture, top-down view, repeating pattern',
  icon: 'game UI icon, simple, bold, centered, clean edges, transparent background',
  environment: 'game background, side-scrolling, layered depth, scenic',
};

export function buildPixelArtPrompt(userPrompt: string, style: PixelArtStyle): string {
  const modifier = STYLE_MODIFIERS[style];
  return `Pixel art style, retro 16-bit, ${modifier}, ${userPrompt}. Clean pixel art, no anti-aliasing, sharp pixel edges, limited color palette.`;
}

export class PixelArtClient {
  constructor(
    private apiKey: string,
    private provider: PixelArtProvider
  ) {}

  async generate(params: GenerateParams): Promise<GenerateResult> {
    const enhancedPrompt = buildPixelArtPrompt(params.prompt, params.style);

    if (this.provider === 'openai') {
      return this.generateDalle(enhancedPrompt, params.size);
    }
    return this.generateReplicate(enhancedPrompt, params.size);
  }

  private async generateDalle(prompt: string, size: 512 | 1024): Promise<OpenAIResult> {
    const response = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: 'dall-e-3',
        prompt,
        n: 1,
        size: `${size}x${size}`,
        response_format: 'b64_json',
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`OpenAI API error ${response.status}: ${text}`);
    }

    const data = await response.json();
    return { base64: data.data[0].b64_json };
  }

  private async generateReplicate(prompt: string, _size: 512 | 1024): Promise<ReplicateResult> {
    const response = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        version: 'stability-ai/sdxl:latest',
        input: {
          prompt,
          negative_prompt: 'blurry, anti-aliased, smooth gradients, realistic, photograph',
          num_outputs: 1,
          width: 1024,
          height: 1024,
        },
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Replicate API error ${response.status}: ${text}`);
    }

    const data = await response.json();
    return { predictionId: data.id, status: data.status };
  }

  async getReplicateStatus(predictionId: string): Promise<{ status: string; output?: string[] }> {
    const response = await fetch(`https://api.replicate.com/v1/predictions/${predictionId}`, {
      headers: { 'Authorization': `Bearer ${this.apiKey}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Replicate status error ${response.status}`);
    const data = await response.json();
    return { status: data.status, output: data.output };
  }
}
```

**Step 4: Run tests**

Run: `cd web && npx vitest run src/lib/generate/__tests__/pixelArtClient.test.ts`
Expected: PASS (9 tests)

**Step 5: Commit**

```bash
git add web/src/lib/generate/pixelArtClient.ts web/src/lib/generate/__tests__/pixelArtClient.test.ts
git commit -m "feat(pixel-art): add AI generation client with prompt engineering"
```

---

### Task 5: API Route

**Files:**
- Create: `web/src/app/api/generate/pixel-art/route.ts`
- Create: `web/src/app/api/generate/pixel-art/__tests__/route.test.ts`

**Step 1: Write the failing tests**

```typescript
// web/src/app/api/generate/pixel-art/__tests__/route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before import
vi.mock('@/lib/auth/authenticateRequest', () => ({
  authenticateRequest: vi.fn(),
}));
vi.mock('@/lib/keys/resolver', () => ({
  resolveApiKey: vi.fn(),
  ApiKeyError: class extends Error {
    code: string;
    constructor(code: string, msg: string) { super(msg); this.code = code; }
  },
}));
vi.mock('@/lib/generate/pixelArtClient', () => ({
  PixelArtClient: vi.fn().mockImplementation(() => ({
    generate: vi.fn().mockResolvedValue({ base64: 'test-base64' }),
  })),
  buildPixelArtPrompt: vi.fn().mockReturnValue('enhanced prompt'),
}));
vi.mock('@/lib/rateLimit', () => ({
  rateLimit: vi.fn().mockResolvedValue({ ok: true }),
}));

import { POST } from '../route';
import { authenticateRequest } from '@/lib/auth/authenticateRequest';
import { resolveApiKey } from '@/lib/keys/resolver';
import { NextRequest } from 'next/server';

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost:3000/api/generate/pixel-art', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('POST /api/generate/pixel-art', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: true,
      ctx: { userId: 'user-1', tier: 'creator' },
    } as never);
    vi.mocked(resolveApiKey).mockResolvedValue({
      type: 'platform',
      key: 'test-key',
      metered: true,
      usageId: 'usage-1',
    });
  });

  it('should return 201 with job data on valid request', async () => {
    const res = await POST(makeRequest({
      prompt: 'a warrior knight',
      targetSize: 32,
      palette: 'pico-8',
      dithering: 'none',
      ditheringIntensity: 0,
      style: 'character',
    }));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.provider).toBeDefined();
    expect(data.status).toBeDefined();
  });

  it('should return 401 when not authenticated', async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: false,
      response: new Response('Unauthorized', { status: 401 }),
    } as never);

    const res = await POST(makeRequest({ prompt: 'test' }));
    expect(res.status).toBe(401);
  });

  it('should return 400 for missing prompt', async () => {
    const res = await POST(makeRequest({
      targetSize: 32,
      palette: 'pico-8',
    }));
    expect(res.status).toBe(400);
  });

  it('should return 400 for invalid targetSize', async () => {
    const res = await POST(makeRequest({
      prompt: 'test',
      targetSize: 99,
      palette: 'pico-8',
    }));
    expect(res.status).toBe(400);
  });

  it('should return 400 for invalid palette name', async () => {
    const res = await POST(makeRequest({
      prompt: 'test',
      targetSize: 32,
      palette: 'invalid-palette',
    }));
    expect(res.status).toBe(400);
  });

  it('should return 400 for invalid dithering type', async () => {
    const res = await POST(makeRequest({
      prompt: 'test',
      targetSize: 32,
      palette: 'pico-8',
      dithering: 'invalid',
    }));
    expect(res.status).toBe(400);
  });

  it('should accept custom palette with valid colors', async () => {
    const res = await POST(makeRequest({
      prompt: 'test sprite',
      targetSize: 32,
      palette: 'custom',
      customPalette: ['#ff0000', '#00ff00', '#0000ff'],
      dithering: 'none',
      ditheringIntensity: 0,
      style: 'character',
    }));
    expect(res.status).toBe(201);
  });

  it('should return 400 for custom palette without colors', async () => {
    const res = await POST(makeRequest({
      prompt: 'test',
      targetSize: 32,
      palette: 'custom',
    }));
    expect(res.status).toBe(400);
  });

  it('should route pixel-art to replicate by default', async () => {
    const res = await POST(makeRequest({
      prompt: 'a knight',
      targetSize: 32,
      palette: 'pico-8',
      style: 'character',
    }));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.provider).toBe('replicate');
  });

  it('should use openai when provider=openai', async () => {
    const res = await POST(makeRequest({
      prompt: 'a knight',
      targetSize: 32,
      palette: 'pico-8',
      style: 'character',
      provider: 'openai',
    }));
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.provider).toBe('openai');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run src/app/api/generate/pixel-art/__tests__/route.test.ts`
Expected: FAIL

**Step 3: Write the implementation**

```typescript
// web/src/app/api/generate/pixel-art/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth/authenticateRequest';
import { resolveApiKey, ApiKeyError } from '@/lib/keys/resolver';
import { rateLimit } from '@/lib/rateLimit';
import { PixelArtClient } from '@/lib/generate/pixelArtClient';
import { PALETTES, validateCustomPalette, type PaletteId } from '@/lib/generate/palettes';

const VALID_SIZES = [16, 32, 64, 128];
const VALID_DITHERING = ['none', 'bayer4x4', 'bayer8x8'];
const VALID_STYLES = ['character', 'prop', 'tile', 'icon', 'environment'];
const VALID_PROVIDERS = ['auto', 'openai', 'replicate'];
const PALETTE_IDS = Object.keys(PALETTES);

const TOKEN_COSTS: Record<string, number> = {
  replicate: 10,
  openai: 20,
};

export async function POST(request: NextRequest) {
  // 1. Auth
  const authResult = await authenticateRequest();
  if (!authResult.ok) return authResult.response;
  const { userId } = authResult.ctx;

  // 2. Rate limit
  const rl = await rateLimit(`gen-pixel-art:${userId}`, 10, 300_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Try again in a few minutes.' },
      { status: 429 }
    );
  }

  // 3. Parse body
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // 4. Validate
  const prompt = body.prompt;
  if (typeof prompt !== 'string' || prompt.length < 3 || prompt.length > 1000) {
    return NextResponse.json({ error: 'prompt must be 3-1000 characters' }, { status: 400 });
  }

  const targetSize = body.targetSize ?? 32;
  if (!VALID_SIZES.includes(targetSize as number)) {
    return NextResponse.json({ error: `targetSize must be one of: ${VALID_SIZES.join(', ')}` }, { status: 400 });
  }

  const palette = body.palette ?? 'pico-8';
  if (typeof palette !== 'string' || !PALETTE_IDS.includes(palette)) {
    return NextResponse.json({ error: `palette must be one of: ${PALETTE_IDS.join(', ')}` }, { status: 400 });
  }

  if (palette === 'custom') {
    const customPalette = body.customPalette;
    if (!Array.isArray(customPalette)) {
      return NextResponse.json({ error: 'customPalette required when palette=custom' }, { status: 400 });
    }
    const validation = validateCustomPalette(customPalette as string[]);
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }
  }

  const dithering = body.dithering ?? 'none';
  if (!VALID_DITHERING.includes(dithering as string)) {
    return NextResponse.json({ error: `dithering must be one of: ${VALID_DITHERING.join(', ')}` }, { status: 400 });
  }

  const ditheringIntensity = typeof body.ditheringIntensity === 'number'
    ? Math.max(0, Math.min(1, body.ditheringIntensity))
    : 0;

  const style = body.style ?? 'character';
  if (!VALID_STYLES.includes(style as string)) {
    return NextResponse.json({ error: `style must be one of: ${VALID_STYLES.join(', ')}` }, { status: 400 });
  }

  const providerPref = body.provider ?? 'auto';
  if (!VALID_PROVIDERS.includes(providerPref as string)) {
    return NextResponse.json({ error: `provider must be one of: ${VALID_PROVIDERS.join(', ')}` }, { status: 400 });
  }

  // 5. Resolve provider
  const actualProvider = (providerPref === 'auto' || providerPref === 'replicate') ? 'replicate' : 'openai';
  const tokenCost = TOKEN_COSTS[actualProvider];
  const providerKey = actualProvider === 'openai' ? 'dalle3' : 'replicate';

  // 6. Resolve API key + deduct tokens
  let apiKey: string;
  let usageId: string | undefined;
  try {
    const resolved = await resolveApiKey(userId, providerKey, tokenCost, 'pixel_art_generation', {
      prompt,
      targetSize,
      palette,
      style,
    });
    apiKey = resolved.key;
    usageId = resolved.usageId;
  } catch (err) {
    if (err instanceof ApiKeyError) {
      const status = err.code === 'INSUFFICIENT_TOKENS' ? 402 : 403;
      return NextResponse.json({ error: err.message }, { status });
    }
    throw err;
  }

  // 7. Generate
  try {
    const client = new PixelArtClient(apiKey, actualProvider);
    const result = await client.generate({
      prompt,
      style: style as 'character' | 'prop' | 'tile' | 'icon' | 'environment',
      size: 1024,
    });

    const jobId = crypto.randomUUID();

    return NextResponse.json({
      jobId,
      provider: actualProvider,
      status: result.base64 ? 'completed' : 'processing',
      base64: result.base64,
      predictionId: result.predictionId,
      usageId,
      tokenCost,
      postProcessing: {
        targetSize,
        palette: palette as PaletteId,
        customPalette: palette === 'custom' ? body.customPalette : undefined,
        dithering,
        ditheringIntensity,
      },
    }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: `Generation failed: ${err instanceof Error ? err.message : 'Unknown error'}` },
      { status: 500 }
    );
  }
}
```

**Step 4: Run tests**

Run: `cd web && npx vitest run src/app/api/generate/pixel-art/__tests__/route.test.ts`
Expected: PASS (10 tests)

**Step 5: Commit**

```bash
git add web/src/app/api/generate/pixel-art/route.ts web/src/app/api/generate/pixel-art/__tests__/route.test.ts
git commit -m "feat(pixel-art): add /api/generate/pixel-art route with auth, validation, token deduction"
```

---

### Task 6: MCP Command Handlers

**Files:**
- Create: `web/src/lib/chat/handlers/pixelArtHandlers.ts`
- Create: `web/src/lib/chat/handlers/__tests__/pixelArtHandlers.test.ts`
- Modify: `web/src/lib/chat/executor.ts` (register handlers)

**Step 1: Write the failing tests**

```typescript
// web/src/lib/chat/handlers/__tests__/pixelArtHandlers.test.ts
import { describe, it, expect, vi } from 'vitest';
import {
  handleGeneratePixelArt,
  handleSetPixelArtPalette,
  handleQuantizeSpriteColors,
} from '../pixelArtHandlers';
import type { ToolCallContext } from '../types';

const mockCtx: ToolCallContext = {
  store: {} as never,
  dispatchCommand: vi.fn(),
};

// Mock fetch globally
global.fetch = vi.fn();

describe('pixelArtHandlers', () => {
  describe('handleGeneratePixelArt', () => {
    it('should return error if prompt is missing', async () => {
      const result = await handleGeneratePixelArt({}, mockCtx);
      expect(result.success).toBe(false);
      expect(result.error).toContain('prompt');
    });

    it('should return error if prompt is too short', async () => {
      const result = await handleGeneratePixelArt({ prompt: 'ab' }, mockCtx);
      expect(result.success).toBe(false);
    });

    it('should return error for invalid targetSize', async () => {
      const result = await handleGeneratePixelArt({
        prompt: 'a knight',
        targetSize: 99,
      }, mockCtx);
      expect(result.success).toBe(false);
      expect(result.error).toContain('targetSize');
    });

    it('should return error for invalid palette', async () => {
      const result = await handleGeneratePixelArt({
        prompt: 'a knight',
        palette: 'nonexistent',
      }, mockCtx);
      expect(result.success).toBe(false);
      expect(result.error).toContain('palette');
    });

    it('should call API and return result on valid args', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          jobId: 'j-1',
          provider: 'replicate',
          status: 'processing',
        }),
      } as Response);

      const result = await handleGeneratePixelArt({
        prompt: 'a warrior knight',
        targetSize: 32,
        palette: 'pico-8',
        style: 'character',
      }, mockCtx);
      expect(result.success).toBe(true);
      expect(result.result).toHaveProperty('jobId');
    });

    it('should handle API failure gracefully', async () => {
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: 'Server error' }),
      } as Response);

      const result = await handleGeneratePixelArt({
        prompt: 'a warrior knight',
      }, mockCtx);
      expect(result.success).toBe(false);
    });
  });

  describe('handleSetPixelArtPalette', () => {
    it('should return error if palette is missing', async () => {
      const result = await handleSetPixelArtPalette({}, mockCtx);
      expect(result.success).toBe(false);
    });

    it('should return error for unknown palette', async () => {
      const result = await handleSetPixelArtPalette({ palette: 'bad' }, mockCtx);
      expect(result.success).toBe(false);
    });

    it('should dispatch command for valid palette', async () => {
      const result = await handleSetPixelArtPalette({ palette: 'endesga-32' }, mockCtx);
      expect(result.success).toBe(true);
      expect(result.result).toHaveProperty('palette');
    });
  });

  describe('handleQuantizeSpriteColors', () => {
    it('should return error if colorCount is missing', async () => {
      const result = await handleQuantizeSpriteColors({}, mockCtx);
      expect(result.success).toBe(false);
    });

    it('should return error for colorCount out of range', async () => {
      const r1 = await handleQuantizeSpriteColors({ colorCount: 0 }, mockCtx);
      expect(r1.success).toBe(false);
      const r2 = await handleQuantizeSpriteColors({ colorCount: 300 }, mockCtx);
      expect(r2.success).toBe(false);
    });

    it('should return success for valid colorCount', async () => {
      const result = await handleQuantizeSpriteColors({ colorCount: 16 }, mockCtx);
      expect(result.success).toBe(true);
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run src/lib/chat/handlers/__tests__/pixelArtHandlers.test.ts`
Expected: FAIL

**Step 3: Write the implementation**

```typescript
// web/src/lib/chat/handlers/pixelArtHandlers.ts
import type { ToolHandler, ExecutionResult, ToolCallContext } from './types';
import { PALETTES, type PaletteId } from '@/lib/generate/palettes';
import { hexToRgb } from '@/lib/generate/colorUtils';

const VALID_SIZES = [16, 32, 64, 128];
const VALID_DITHERING = ['none', 'bayer4x4', 'bayer8x8'];
const VALID_STYLES = ['character', 'prop', 'tile', 'icon', 'environment'];
const PALETTE_IDS = Object.keys(PALETTES);

export const handleGeneratePixelArt: ToolHandler = async (
  args: Record<string, unknown>,
  _ctx: ToolCallContext
): Promise<ExecutionResult> => {
  const prompt = args.prompt;
  if (typeof prompt !== 'string' || prompt.length < 3) {
    return { success: false, error: 'prompt is required and must be at least 3 characters' };
  }

  const targetSize = args.targetSize ?? 32;
  if (!VALID_SIZES.includes(targetSize as number)) {
    return { success: false, error: `targetSize must be one of: ${VALID_SIZES.join(', ')}` };
  }

  const palette = (args.palette ?? 'pico-8') as string;
  if (!PALETTE_IDS.includes(palette)) {
    return { success: false, error: `palette must be one of: ${PALETTE_IDS.join(', ')}` };
  }

  const dithering = (args.dithering ?? 'none') as string;
  if (!VALID_DITHERING.includes(dithering)) {
    return { success: false, error: `dithering must be one of: ${VALID_DITHERING.join(', ')}` };
  }

  const style = (args.style ?? 'character') as string;
  if (!VALID_STYLES.includes(style)) {
    return { success: false, error: `style must be one of: ${VALID_STYLES.join(', ')}` };
  }

  try {
    const response = await fetch('/api/generate/pixel-art', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        targetSize,
        palette,
        customPalette: args.customPalette,
        dithering,
        ditheringIntensity: args.ditheringIntensity ?? 0,
        style,
        provider: args.provider ?? 'auto',
        entityId: args.entityId,
      }),
    });

    if (!response.ok) {
      const data = await response.json();
      return { success: false, error: data.error ?? `API error ${response.status}` };
    }

    const data = await response.json();
    return {
      success: true,
      result: data,
      message: `Pixel art generation started (${data.provider}, ${targetSize}px, ${palette} palette)`,
    };
  } catch (err) {
    return { success: false, error: `Generation failed: ${err instanceof Error ? err.message : 'Unknown error'}` };
  }
};

export const handleSetPixelArtPalette: ToolHandler = async (
  args: Record<string, unknown>,
  _ctx: ToolCallContext
): Promise<ExecutionResult> => {
  const paletteId = args.palette;
  if (typeof paletteId !== 'string' || !PALETTE_IDS.includes(paletteId)) {
    return { success: false, error: `palette must be one of: ${PALETTE_IDS.join(', ')}` };
  }

  const palette = PALETTES[paletteId as PaletteId];
  const colors = palette.colors.map((hex) => hexToRgb(hex));

  return {
    success: true,
    result: { palette: paletteId, name: palette.name, colorCount: colors.length, colors: palette.colors },
    message: `Set palette to ${palette.name} (${colors.length} colors)`,
  };
};

export const handleQuantizeSpriteColors: ToolHandler = async (
  args: Record<string, unknown>,
  _ctx: ToolCallContext
): Promise<ExecutionResult> => {
  const colorCount = args.colorCount;
  if (typeof colorCount !== 'number' || colorCount < 1 || colorCount > 256) {
    return { success: false, error: 'colorCount must be between 1 and 256' };
  }

  const dithering = (args.dithering ?? 'none') as string;
  if (!VALID_DITHERING.includes(dithering)) {
    return { success: false, error: `dithering must be one of: ${VALID_DITHERING.join(', ')}` };
  }

  return {
    success: true,
    result: {
      colorCount,
      dithering,
      ditheringIntensity: args.ditheringIntensity ?? 0,
    },
    message: `Quantized sprite to ${colorCount} colors${dithering !== 'none' ? ` with ${dithering} dithering` : ''}`,
  };
};
```

**Step 4: Run tests**

Run: `cd web && npx vitest run src/lib/chat/handlers/__tests__/pixelArtHandlers.test.ts`
Expected: PASS (11 tests)

**Step 5: Register handlers in executor**

Modify `web/src/lib/chat/executor.ts` — add import and register:

```typescript
import { handleGeneratePixelArt, handleSetPixelArtPalette, handleQuantizeSpriteColors } from './handlers/pixelArtHandlers';

// In the handler registry:
'generate_pixel_art': handleGeneratePixelArt,
'set_pixel_art_palette': handleSetPixelArtPalette,
'quantize_sprite_colors': handleQuantizeSpriteColors,
```

**Step 6: Commit**

```bash
git add web/src/lib/chat/handlers/pixelArtHandlers.ts web/src/lib/chat/handlers/__tests__/pixelArtHandlers.test.ts web/src/lib/chat/executor.ts
git commit -m "feat(pixel-art): add MCP command handlers for pixel art generation"
```

---

### Task 7: GeneratePixelArtDialog UI Component

**Files:**
- Create: `web/src/components/editor/GeneratePixelArtDialog.tsx`
- Create: `web/src/components/editor/__tests__/GeneratePixelArtDialog.test.tsx`

**Step 1: Write the failing tests**

```typescript
// web/src/components/editor/__tests__/GeneratePixelArtDialog.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GeneratePixelArtDialog } from '../GeneratePixelArtDialog';

// Mock stores
vi.mock('@/stores/generationStore', () => ({
  useGenerationStore: vi.fn(() => ({
    addJob: vi.fn(),
  })),
}));
vi.mock('@/stores/userStore', () => ({
  useUserStore: vi.fn((sel: (s: { tokenBalance: { total: number } }) => unknown) =>
    sel({ tokenBalance: { total: 100 } })
  ),
}));

describe('GeneratePixelArtDialog', () => {
  const defaultProps = { isOpen: true, onClose: vi.fn() };

  it('should render when open', () => {
    render(<GeneratePixelArtDialog {...defaultProps} />);
    expect(screen.getByText(/pixel art/i)).toBeDefined();
  });

  it('should not render when closed', () => {
    render(<GeneratePixelArtDialog isOpen={false} onClose={vi.fn()} />);
    expect(screen.queryByText(/pixel art/i)).toBeNull();
  });

  it('should show prompt input', () => {
    render(<GeneratePixelArtDialog {...defaultProps} />);
    expect(screen.getByPlaceholderText(/describe/i)).toBeDefined();
  });

  it('should show palette selector', () => {
    render(<GeneratePixelArtDialog {...defaultProps} />);
    expect(screen.getByText(/palette/i)).toBeDefined();
  });

  it('should show target size selector', () => {
    render(<GeneratePixelArtDialog {...defaultProps} />);
    expect(screen.getByText(/size/i)).toBeDefined();
  });

  it('should show dithering options', () => {
    render(<GeneratePixelArtDialog {...defaultProps} />);
    expect(screen.getByText(/dither/i)).toBeDefined();
  });

  it('should show token cost', () => {
    render(<GeneratePixelArtDialog {...defaultProps} />);
    expect(screen.getByText(/token/i)).toBeDefined();
  });

  it('should disable submit with empty prompt', () => {
    render(<GeneratePixelArtDialog {...defaultProps} />);
    const button = screen.getByRole('button', { name: /generate/i });
    expect(button).toHaveProperty('disabled', true);
  });

  it('should enable submit with valid prompt', () => {
    render(<GeneratePixelArtDialog {...defaultProps} />);
    const input = screen.getByPlaceholderText(/describe/i);
    fireEvent.change(input, { target: { value: 'a warrior knight with sword' } });
    const button = screen.getByRole('button', { name: /generate/i });
    expect(button).toHaveProperty('disabled', false);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd web && npx vitest run src/components/editor/__tests__/GeneratePixelArtDialog.test.tsx`
Expected: FAIL

**Step 3: Write the implementation**

```typescript
// web/src/components/editor/GeneratePixelArtDialog.tsx
'use client';

import { useState, useCallback } from 'react';
import { X, Wand2 } from 'lucide-react';
import { useGenerationStore } from '@/stores/generationStore';
import { useUserStore } from '@/stores/userStore';
import { PALETTES, type PaletteId } from '@/lib/generate/palettes';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

const SIZES = [16, 32, 64, 128] as const;
const STYLES = ['character', 'prop', 'tile', 'icon', 'environment'] as const;
const DITHER_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'bayer4x4', label: 'Bayer 4x4' },
  { value: 'bayer8x8', label: 'Bayer 8x8' },
] as const;

const PRESET_IDS = Object.keys(PALETTES).filter((id) => id !== 'custom') as PaletteId[];

export function GeneratePixelArtDialog({ isOpen, onClose }: Props) {
  const [prompt, setPrompt] = useState('');
  const [targetSize, setTargetSize] = useState<(typeof SIZES)[number]>(32);
  const [palette, setPalette] = useState<PaletteId>('pico-8');
  const [style, setStyle] = useState<(typeof STYLES)[number]>('character');
  const [dithering, setDithering] = useState<string>('none');
  const [ditheringIntensity, setDitheringIntensity] = useState(0.5);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tokenBalance = useUserStore((s) => s.tokenBalance.total);
  const addJob = useGenerationStore((s) => s.addJob);

  const tokenCost = 10; // SDXL default
  const canSubmit = prompt.length >= 3 && tokenBalance >= tokenCost && !isSubmitting;

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;
    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch('/api/generate/pixel-art', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          targetSize,
          palette,
          dithering,
          ditheringIntensity: dithering === 'none' ? 0 : ditheringIntensity,
          style,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        setError(data.error ?? 'Generation failed');
        return;
      }

      addJob({
        id: crypto.randomUUID(),
        jobId: data.jobId,
        type: 'sprite',
        prompt,
        status: data.status === 'completed' ? 'completed' : 'pending',
        provider: data.provider,
        usageId: data.usageId,
        metadata: { targetSize, palette, dithering, ditheringIntensity, style },
      });

      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsSubmitting(false);
    }
  }, [canSubmit, prompt, targetSize, palette, dithering, ditheringIntensity, style, addJob, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-zinc-900 border border-zinc-700 rounded-lg w-[480px] max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-zinc-700">
          <div className="flex items-center gap-2">
            <Wand2 size={18} className="text-blue-400" />
            <h2 className="text-sm font-semibold text-zinc-100">Generate Pixel Art</h2>
          </div>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-200">
            <X size={16} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Prompt */}
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Prompt</label>
            <textarea
              placeholder="Describe your pixel art sprite..."
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-600 rounded px-3 py-2 text-sm text-zinc-100 resize-none"
              rows={3}
            />
          </div>

          {/* Style */}
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Style</label>
            <select
              value={style}
              onChange={(e) => setStyle(e.target.value as typeof style)}
              className="w-full bg-zinc-800 border border-zinc-600 rounded px-3 py-2 text-sm text-zinc-100"
            >
              {STYLES.map((s) => (
                <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
              ))}
            </select>
          </div>

          {/* Size */}
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Target Size</label>
            <div className="flex gap-2">
              {SIZES.map((s) => (
                <button
                  key={s}
                  onClick={() => setTargetSize(s)}
                  className={`px-3 py-1 text-xs rounded border ${
                    targetSize === s
                      ? 'bg-blue-600 border-blue-500 text-white'
                      : 'bg-zinc-800 border-zinc-600 text-zinc-300 hover:border-zinc-400'
                  }`}
                >
                  {s}px
                </button>
              ))}
            </div>
          </div>

          {/* Palette */}
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Palette</label>
            <select
              value={palette}
              onChange={(e) => setPalette(e.target.value as PaletteId)}
              className="w-full bg-zinc-800 border border-zinc-600 rounded px-3 py-2 text-sm text-zinc-100"
            >
              {PRESET_IDS.map((id) => (
                <option key={id} value={id}>
                  {PALETTES[id].name} ({PALETTES[id].colors.length} colors)
                </option>
              ))}
            </select>
            {/* Palette preview */}
            <div className="flex flex-wrap gap-0.5 mt-2">
              {PALETTES[palette].colors.slice(0, 32).map((color, i) => (
                <div
                  key={i}
                  className="w-4 h-4 rounded-sm border border-zinc-600"
                  style={{ backgroundColor: color }}
                />
              ))}
              {PALETTES[palette].colors.length > 32 && (
                <span className="text-xs text-zinc-500 ml-1">
                  +{PALETTES[palette].colors.length - 32} more
                </span>
              )}
            </div>
          </div>

          {/* Dithering */}
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Dithering</label>
            <select
              value={dithering}
              onChange={(e) => setDithering(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-600 rounded px-3 py-2 text-sm text-zinc-100"
            >
              {DITHER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            {dithering !== 'none' && (
              <div className="mt-2">
                <label className="text-xs text-zinc-500">
                  Intensity: {Math.round(ditheringIntensity * 100)}%
                </label>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={ditheringIntensity}
                  onChange={(e) => setDitheringIntensity(parseFloat(e.target.value))}
                  className="w-full"
                />
              </div>
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="text-xs text-red-400 bg-red-900/20 border border-red-800 rounded p-2">
              {error}
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center justify-between pt-2 border-t border-zinc-700">
            <span className="text-xs text-zinc-400">
              Cost: {tokenCost} tokens (Balance: {tokenBalance})
            </span>
            <button
              onClick={handleSubmit}
              disabled={!canSubmit}
              className={`px-4 py-2 text-sm font-medium rounded ${
                canSubmit
                  ? 'bg-blue-600 hover:bg-blue-500 text-white'
                  : 'bg-zinc-700 text-zinc-500 cursor-not-allowed'
              }`}
            >
              {isSubmitting ? 'Generating...' : 'Generate'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

**Step 4: Run tests**

Run: `cd web && npx vitest run src/components/editor/__tests__/GeneratePixelArtDialog.test.tsx`
Expected: PASS (9 tests)

**Step 5: Commit**

```bash
git add web/src/components/editor/GeneratePixelArtDialog.tsx web/src/components/editor/__tests__/GeneratePixelArtDialog.test.tsx
git commit -m "feat(pixel-art): add GeneratePixelArtDialog UI component"
```

---

### Task 8: Lint, TypeScript, and Full Test Suite Verification

**Step 1: Run full lint**

Run: `cd web && npx eslint --max-warnings 0 src/lib/generate/ src/app/api/generate/pixel-art/ src/lib/chat/handlers/pixelArtHandlers.ts src/components/editor/GeneratePixelArtDialog.tsx`
Expected: 0 errors, 0 warnings. Fix any issues.

**Step 2: Run TypeScript check**

Run: `cd web && npx tsc --noEmit`
Expected: No errors. Fix any type issues.

**Step 3: Run full test suite**

Run: `cd web && npx vitest run`
Expected: All existing tests pass + 77 new tests pass (17 palette + 13 color + 18 processor + 9 client + 10 route + 11 handlers + 9 dialog = 87 total new tests)

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat(pixel-art): Phase 1 complete - AI pixel art pipeline with 87 tests"
```

---

## Summary

| Task | Files | Tests |
|------|-------|-------|
| 1. Palettes | `palettes.ts` | 17 |
| 2. Color Utils | `colorUtils.ts` | 13 |
| 3. Processor | `pixelArtProcessor.ts` | 18 |
| 4. AI Client | `pixelArtClient.ts` | 9 |
| 5. API Route | `route.ts` | 10 |
| 6. MCP Handlers | `pixelArtHandlers.ts` + executor | 11 |
| 7. UI Dialog | `GeneratePixelArtDialog.tsx` | 9 |
| 8. Verification | lint + tsc + full suite | — |
| **Total** | **7 new files + 7 test files + 1 modified** | **87** |
