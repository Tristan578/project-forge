import { readFile } from 'node:fs/promises';

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

// These Unicode blocks are present in the three bundled fonts. Deliberately
// reject every other script before Satori gets the text: Satori's fallback for
// a missing code point is a Google Fonts request containing that text.
const COVERED_TEXT = /^[\u0009\u000A\u000D\u0020-\u024F\u0370-\u052F\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\u2000-\u206F\u3000-\u30FF\u3100-\u312F\u3130-\u318F\u31A0-\u31BF\u3200-\u32FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF]+$/u;

export function isPlayCardTextCovered(text: string): boolean {
  return COVERED_TEXT.test(text);
}
