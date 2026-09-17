/** Load traced OG fonts and reject text not covered by their exact glyph maps. */
import { readFile } from 'node:fs/promises';
import { PLAY_CARD_GLYPH_RANGES } from './play-card-glyphs';

/** A local font face passed to Satori with its exact supported weight. */
export type OgFont = {
  name: string;
  data: ArrayBuffer;
  weight: 400 | 700;
};

const fontAsset = (file: string) => new URL('../../assets/fonts/' + file, import.meta.url);

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

let pendingFonts: Promise<OgFont[]> | undefined;

/**
 * Read the traced custom fonts on demand. A failed read is deliberately not a
 * module-level rejected promise: image routes may load before the function
 * bundle is complete, and an eager rejection otherwise turns every later
 * request into an unhandled failure. The next request may recover after a
 * transient deployment read failure.
 */
async function readPlayCardFonts(): Promise<OgFont[]> {
  const [latin, latinBold, arabic, cjk] = await Promise.all([
    readFile(fontAsset('NotoSans-Regular.ttf')),
    readFile(fontAsset('NotoSans-Bold.ttf')),
    readFile(fontAsset('SpawnForgeArabic-Regular.ttf')),
    readFile(fontAsset('NotoSansCJKjp-Regular.otf')),
  ]);
  return [
    { name: 'SpawnForge OG Latin', data: asArrayBuffer(latin), weight: 400 },
    // Satori resolves a face only when its requested weight is explicitly
    // registered. This local Bold face preserves the prior 700 Latin title.
    { name: 'SpawnForge OG Latin', data: asArrayBuffer(latinBold), weight: 700 },
    { name: 'SpawnForge OG Arabic', data: asArrayBuffer(arabic), weight: 400 },
    { name: 'SpawnForge OG CJK', data: asArrayBuffer(cjk), weight: 400 },
  ];
}

/**
 * Return custom fonts when every local asset is readable, otherwise null.
 * Callers must omit ImageResponse's `fonts` option for null and render only
 * neutral ASCII text with Next's bundled local fallback font.
 * @returns Cached local faces, or null after a failed read; the next call retries.
 */
export async function loadPlayCardFonts(): Promise<OgFont[] | null> {
  pendingFonts ??= readPlayCardFonts();
  try {
    return await pendingFonts;
  } catch {
    pendingFonts = undefined;
    return null;
  }
}

/**
 * Reject missing glyphs before Next's automatic fallback can transmit user text.
 * @param text Card text to check, iterated as Unicode code points.
 * @returns True when all characters have local glyphs or are supported layout
 * whitespace; false for empty text or any missing glyph, including lone surrogates.
 */
export function isPlayCardTextCovered(text: string): boolean {
  if (text.length === 0) return false;
  for (const character of text) {
    const point = character.codePointAt(0)!;
    let low = 0;
    let high = PLAY_CARD_GLYPH_RANGES.length - 1;
    let covered = false;
    while (low <= high) {
      const middle = (low + high) >>> 1;
      const [start, end] = PLAY_CARD_GLYPH_RANGES[middle];
      if (point < start) high = middle - 1;
      else if (point > end) low = middle + 1;
      else { covered = true; break; }
    }
    if (!covered) return false;
  }
  return true;
}
