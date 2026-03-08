import { findNearestColor, type RGB } from './colorUtils';

export interface PixelGrid {
  width: number;
  height: number;
  pixels: RGB[];
}

export interface ProcessOptions {
  targetWidth: number;
  targetHeight: number;
  paletteColors?: number;
  presetPalette?: RGB[];
  dithering: 'none' | 'bayer4x4' | 'bayer8x8';
  ditheringIntensity: number;
}

export function nearestNeighborDownscale(src: PixelGrid, dstW: number, dstH: number): PixelGrid {
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

export function medianCutQuantize(pixels: RGB[], targetColors: number): RGB[] {
  if (targetColors <= 0) return [];
  if (pixels.length === 0) return [];
  const uniqueMap = new Map<string, RGB>();
  for (const p of pixels) {
    const key = p.join(',');
    if (!uniqueMap.has(key)) uniqueMap.set(key, p);
  }
  const unique = Array.from(uniqueMap.values());
  if (unique.length <= targetColors) {
    return unique.map((c) => [...c] as RGB);
  }
  const buckets: RGB[][] = [unique];
  while (buckets.length < targetColors) {
    let maxRange = -1;
    let maxIdx = 0;
    for (let i = 0; i < buckets.length; i++) {
      const range = channelRange(buckets[i]);
      if (range.range > maxRange) {
        maxRange = range.range;
        maxIdx = i;
      }
    }
    if (maxRange === 0) break;
    const bucket = buckets[maxIdx];
    const { channel } = channelRange(bucket);
    bucket.sort((a, b) => a[channel] - b[channel]);
    const mid = Math.floor(bucket.length / 2);
    const left = bucket.slice(0, mid);
    const right = bucket.slice(mid);
    if (left.length === 0 || right.length === 0) break;
    buckets.splice(maxIdx, 1, left, right);
  }
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

export function applyPaletteMapping(grid: PixelGrid, palette: RGB[]): PixelGrid {
  const pixels = grid.pixels.map((p) => findNearestColor(p, palette));
  return { width: grid.width, height: grid.height, pixels };
}

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

type DitherSize = '4x4' | '8x8';

export function applyBayerDithering(
  grid: PixelGrid, palette: RGB[], intensity: number, matrixType: DitherSize
): PixelGrid {
  if (intensity === 0) {
    return applyPaletteMapping(grid, palette);
  }
  const type = matrixType === '4x4' ? 'bayer4x4' : 'bayer8x8';
  const { matrix, size, maxVal } = getBayerMatrix(type);
  const spread = intensity * 64;
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

export function processPixelArt(src: PixelGrid, opts: ProcessOptions): PixelGrid {
  const downscaled = nearestNeighborDownscale(src, opts.targetWidth, opts.targetHeight);
  let palette: RGB[];
  if (opts.presetPalette) {
    palette = opts.presetPalette;
  } else {
    const numColors = opts.paletteColors ?? 16;
    palette = medianCutQuantize(downscaled.pixels, numColors);
  }
  if (opts.dithering === 'none' || opts.ditheringIntensity === 0) {
    return applyPaletteMapping(downscaled, palette);
  }
  const matrixType: DitherSize = opts.dithering === 'bayer4x4' ? '4x4' : '8x8';
  return applyBayerDithering(downscaled, palette, opts.ditheringIntensity, matrixType);
}
