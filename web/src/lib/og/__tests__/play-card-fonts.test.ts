// @vitest-environment node
import { afterEach, describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { PLAY_CARD_FONT_SHA256, PLAY_CARD_GLYPH_RANGES } from '../play-card-glyphs';
import { isPlayCardTextCovered } from '../play-card-fonts';
import type { OgFont } from '../play-card-fonts';

/** Independently read the preferred Unicode cmap from an actual SFNT asset. */
function unicodeCmap(font: Buffer): Map<number, number> {
  let cmap = -1;
  for (let i = 0; i < font.readUInt16BE(4); i++) {
    const record = 12 + i * 16;
    if (font.toString('ascii', record, record + 4) === 'cmap') cmap = font.readUInt32BE(record + 8);
  }
  if (cmap < 0) throw new Error('Missing cmap');
  const priority = [[3, 10], [0, 6], [0, 4], [3, 1], [0, 3], [0, 2], [0, 1], [0, 0]];
  let offset = -1;
  for (const [platform, encoding] of priority) {
    for (let i = 0; i < font.readUInt16BE(cmap + 2); i++) {
      const record = cmap + 4 + i * 8;
      if (font.readUInt16BE(record) === platform && font.readUInt16BE(record + 2) === encoding) offset = cmap + font.readUInt32BE(record + 4);
    }
    if (offset >= 0) break;
  }
  if (offset < 0) throw new Error('Missing Unicode cmap');
  const format = font.readUInt16BE(offset);
  const glyphs = new Map<number, number>();
  if (format === 12) {
    for (let i = 0; i < font.readUInt32BE(offset + 12); i++) {
      const group = offset + 16 + i * 12;
      const start = font.readUInt32BE(group), end = font.readUInt32BE(group + 4), glyph = font.readUInt32BE(group + 8);
      for (let point = start; point <= end; point++) {
        const glyphId = glyph + point - start;
        if (glyphId !== 0) glyphs.set(point, glyphId);
      }
    }
  } else if (format === 4) {
    const count = font.readUInt16BE(offset + 6) / 2;
    const ends = offset + 14, starts = ends + count * 2 + 2, deltas = starts + count * 2, ranges = deltas + count * 2;
    for (let i = 0; i < count; i++) {
      const start = font.readUInt16BE(starts + i * 2), end = font.readUInt16BE(ends + i * 2);
      const delta = font.readInt16BE(deltas + i * 2), range = font.readUInt16BE(ranges + i * 2);
      for (let point = start; point <= end && point !== 0xffff; point++) {
        const raw = range ? font.readUInt16BE(ranges + i * 2 + range + (point - start) * 2) : point;
        const glyph = range && raw === 0 ? 0 : (raw + delta) & 0xffff;
        if (glyph) glyphs.set(point, glyph);
      }
    }
  } else throw new Error('Unsupported Unicode cmap format ' + format);
  return glyphs;
}

/** Read glyph IDs from either OpenType coverage-table encoding. */
function coverageGlyphIds(font: Buffer, coverage: number): number[] {
  const format = font.readUInt16BE(coverage);
  if (format === 1) {
    const count = font.readUInt16BE(coverage + 2);
    return Array.from({ length: count }, (_, index) => font.readUInt16BE(coverage + 4 + index * 2));
  }
  if (format === 2) {
    const count = font.readUInt16BE(coverage + 2);
    const glyphs: number[] = [];
    for (let index = 0; index < count; index++) {
      const range = coverage + 4 + index * 6;
      const start = font.readUInt16BE(range);
      const end = font.readUInt16BE(range + 2);
      for (let glyph = start; glyph <= end; glyph++) glyphs.push(glyph);
    }
    return glyphs;
  }
  throw new Error('Unsupported GSUB coverage format ' + format);
}

/**
 * Read every replacement glyph from init/medi/fina type-1 single substitutions.
 * The optional mutator supplies a deterministic corrupted-target fixture without
 * changing the checked-in font bytes or weakening their SHA pin.
 */
function arabicReplacementGlyphIds(font: Buffer, mutate = (glyph: number) => glyph): number[] {
  let gsub = -1;
  for (let i = 0; i < font.readUInt16BE(4); i++) {
    const record = 12 + i * 16;
    if (font.toString('ascii', record, record + 4) === 'GSUB') gsub = font.readUInt32BE(record + 8);
  }
  if (gsub < 0) throw new Error('Missing GSUB');
  const features = gsub + font.readUInt16BE(gsub + 6);
  const lookups = gsub + font.readUInt16BE(gsub + 8);
  const tags: string[] = [];
  const replacements: number[] = [];
  for (let i = 0; i < font.readUInt16BE(features); i++) {
    const record = features + 2 + i * 6;
    const tag = font.toString('ascii', record, record + 4);
    tags.push(tag);
    const feature = features + font.readUInt16BE(record + 4);
    const lookupCount = font.readUInt16BE(feature + 2);
    if (lookupCount === 0) throw new Error('Empty ' + tag + ' substitution feature');
    for (let j = 0; j < lookupCount; j++) {
      const index = font.readUInt16BE(feature + 4 + j * 2);
      const lookup = lookups + font.readUInt16BE(lookups + 2 + index * 2);
      if (font.readUInt16BE(lookup) !== 1) throw new Error(tag + ' is not a type-1 substitution');
      const subtableCount = font.readUInt16BE(lookup + 4);
      if (subtableCount === 0) throw new Error('Empty ' + tag + ' lookup');
      for (let k = 0; k < subtableCount; k++) {
        const subtable = lookup + font.readUInt16BE(lookup + 6 + k * 2);
        const coverage = coverageGlyphIds(font, subtable + font.readUInt16BE(subtable + 2));
        if (coverage.length === 0) throw new Error('Empty ' + tag + ' coverage');
        const format = font.readUInt16BE(subtable);
        if (format === 1) {
          const delta = font.readInt16BE(subtable + 4);
          replacements.push(...coverage.map(glyph => mutate((glyph + delta) & 0xffff)));
        } else if (format === 2) {
          const count = font.readUInt16BE(subtable + 4);
          if (count !== coverage.length) throw new Error(tag + ' coverage and substitute counts differ');
          for (let glyph = 0; glyph < count; glyph++) replacements.push(mutate(font.readUInt16BE(subtable + 6 + glyph * 2)));
        } else {
          throw new Error('Unsupported type-1 GSUB format ' + format);
        }
      }
    }
  }
  expect(tags.sort()).toEqual(['fina', 'init', 'medi']);
  return replacements;
}

function assertArabicReplacementGlyphsEncoded(font: Buffer, mutate?: (glyph: number) => number): number[] {
  const encodedGlyphs = new Set(unicodeCmap(font).values());
  const replacements = arabicReplacementGlyphIds(font, mutate);
  if (replacements.length === 0) throw new Error('Arabic GSUB has no replacement glyphs');
  for (const glyph of replacements) {
    if (!encodedGlyphs.has(glyph)) throw new Error('Arabic GSUB replacement glyph ' + glyph + ' is not encoded in cmap');
  }
  return replacements;
}

describe('exact checked-in OG glyph coverage', () => {

  it('retains initial, medial, and final Arabic replacement glyphs in the actual cmap', () => {
    const font = readFileSync(new URL('../../../assets/fonts/SpawnForgeArabic-Regular.ttf', import.meta.url));
    expect(assertArabicReplacementGlyphsEncoded(font)).not.toEqual([]);
  });

  it('rejects a mutated Arabic replacement target that resolves to .notdef', () => {
    const font = readFileSync(new URL('../../../assets/fonts/SpawnForgeArabic-Regular.ttf', import.meta.url));
    expect(() => assertArabicReplacementGlyphsEncoded(font, () => 0)).toThrow('Arabic GSUB replacement glyph 0');
  });

  it('matches the independent font cmap union and source hashes', () => {
    const actual = new Set([9, 10, 13]);
    for (const [file, digest] of Object.entries(PLAY_CARD_FONT_SHA256)) {
      const font = readFileSync(new URL('../../../assets/fonts/' + file, import.meta.url));
      expect(createHash('sha256').update(font).digest('hex'), file + ' requires regeneration').toBe(digest);
      for (const point of unicodeCmap(font).keys()) actual.add(point);
    }
    const generated = new Set<number>();
    let previous = -1;
    for (const [start, end] of PLAY_CARD_GLYPH_RANGES) {
      expect(start).toBeGreaterThan(previous);
      expect(end).toBeGreaterThanOrEqual(start);
      for (let point = start; point <= end; point++) generated.add(point);
      previous = end;
    }
    expect([...generated].sort((a, b) => a - b)).toEqual([...actual].sort((a, b) => a - b));
  });
  it.each(['', '\u03e2', '\u9ff0', '\u{1d400}', '\ud800'])('rejects uncovered glyph %s', text => {
    expect(isPlayCardTextCovered(text)).toBe(false);
  });
  it.each(['星の冒険', '별의 모험', '星际冒险', 'Звёздное приключение', 'مغامرة النجوم', '\u{2000b}', 'Title\nline'])('accepts covered text %s', text => {
    expect(isPlayCardTextCovered(text)).toBe(true);
  });
});

describe('play-card custom font loading', () => {
  afterEach(() => {
    vi.doUnmock('node:fs/promises');
    vi.resetModules();
  });

  /** Assert the exact family and declared weights passed to Satori. */
  const expectFaces = (fonts: OgFont[] | null) => {
    expect(fonts?.map(({ name, weight }) => ({ name, weight }))).toEqual([
      { name: 'SpawnForge OG Latin', weight: 400 },
      { name: 'SpawnForge OG Latin', weight: 700 },
      { name: 'SpawnForge OG Arabic', weight: 400 },
      { name: 'SpawnForge OG CJK', weight: 400 },
    ]);
  };

  it('retries a failed four-asset batch and then caches the recovered faces', async () => {
    vi.resetModules();
    let recover = false;
    const readFile = vi.fn(() => recover
      ? Promise.resolve(new Uint8Array([0, 1, 2]))
      : Promise.reject(new Error('simulated asset failure')));
    vi.doMock('node:fs/promises', () => ({ readFile }));

    const { loadPlayCardFonts } = await import('../play-card-fonts');
    await expect(loadPlayCardFonts()).resolves.toBeNull();
    expect(readFile).toHaveBeenCalledTimes(4);
    recover = true;
    const fonts = await loadPlayCardFonts();
    expect(readFile).toHaveBeenCalledTimes(8);
    expectFaces(fonts);
    expect(await loadPlayCardFonts()).toBe(fonts);
    expect(readFile).toHaveBeenCalledTimes(8);
  });

  it('coalesces overlapping callers into one four-asset read batch', async () => {
    vi.resetModules();
    const readFile = vi.fn().mockResolvedValue(new Uint8Array([0, 1, 2]));
    vi.doMock('node:fs/promises', () => ({ readFile }));

    const { loadPlayCardFonts } = await import('../play-card-fonts');
    expect(readFile).not.toHaveBeenCalled();
    const [first, second] = await Promise.all([loadPlayCardFonts(), loadPlayCardFonts()]);
    expect(readFile).toHaveBeenCalledTimes(4);
    expect(first).toBe(second);
    expectFaces(first);
  });
});
