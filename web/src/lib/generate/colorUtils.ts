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

const paletteLabCache = new WeakMap<RGB[], LAB[]>();

export function findNearestColor(pixel: RGB, palette: RGB[]): RGB {
  if (palette.length === 0) return [...pixel] as RGB;

  const pixelLab = rgbToLab(pixel);

  let paletteLab = paletteLabCache.get(palette);
  if (!paletteLab || paletteLab.length !== palette.length) {
    paletteLab = palette.map((color) => rgbToLab(color));
    paletteLabCache.set(palette, paletteLab);
  }

  let bestDist = Infinity;
  let best = palette[0];
  for (let i = 0; i < palette.length; i++) {
    const dist = labDistance(pixelLab, paletteLab[i]);
    if (dist < bestDist) {
      bestDist = dist;
      best = palette[i];
    }
  }
  return best;
}
