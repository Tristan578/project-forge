import { readFile } from 'node:fs/promises';
import { PLAY_CARD_GLYPH_RANGES } from './play-card-glyphs';

type OgFont = {
  name: string;
  data: ArrayBuffer;
  weight: 400 | 700;
};

const fontAsset = (file: string) => new URL('../../assets/fonts/' + file, import.meta.url);

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/**
 * These assets are traced as Node route files rather than bundled into an Edge
 * function. Their source URLs and OFL-1.1 terms live beside the artifacts.
 */
export const playCardFonts: Promise<OgFont[]> = Promise.all([
  readFile(fontAsset('NotoSans-Regular.ttf')),
  readFile(fontAsset('NotoSansArabic-Satori.ttf')),
  readFile(fontAsset('NotoSansCJKjp-Regular.otf')),
]).then(([latin, arabic, cjk]) => [
  { name: 'SpawnForge OG Latin', data: asArrayBuffer(latin), weight: 400 },
  { name: 'SpawnForge OG Arabic', data: asArrayBuffer(arabic), weight: 400 },
  { name: 'SpawnForge OG CJK', data: asArrayBuffer(cjk), weight: 400 },
]);

/** Reject missing glyphs before Next's automatic fallback can transmit user text. */
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
