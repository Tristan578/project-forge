// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { PLAY_CARD_FONT_SHA256, PLAY_CARD_GLYPH_RANGES } from '../play-card-glyphs';
import { isPlayCardTextCovered } from '../play-card-fonts';

/** Independently read the preferred Unicode cmap from each actual SFNT asset. */
function cmapPoints(font: Buffer): Set<number> {
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
  const points = new Set<number>();
  if (format === 12) {
    for (let i = 0; i < font.readUInt32BE(offset + 12); i++) {
      const group = offset + 16 + i * 12;
      const start = font.readUInt32BE(group), end = font.readUInt32BE(group + 4), glyph = font.readUInt32BE(group + 8);
      for (let point = start; point <= end; point++) if (glyph + point - start !== 0) points.add(point);
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
        if (glyph) points.add(point);
      }
    }
  } else throw new Error('Unsupported Unicode cmap format ' + format);
  return points;
}

describe('exact checked-in OG glyph coverage', () => {

  it('retains nonempty initial, medial, and final Arabic substitutions', () => {
    const font = readFileSync(new URL('../../../assets/fonts/SpawnForgeArabic-Regular.ttf', import.meta.url));
    let gsub = -1;
    for (let i = 0; i < font.readUInt16BE(4); i++) {
      const record = 12 + i * 16;
      if (font.toString('ascii', record, record + 4) === 'GSUB') gsub = font.readUInt32BE(record + 8);
    }
    expect(gsub).toBeGreaterThan(0);
    const features = gsub + font.readUInt16BE(gsub + 6);
    const lookups = gsub + font.readUInt16BE(gsub + 8);
    const tags: string[] = [];
    for (let i = 0; i < font.readUInt16BE(features); i++) {
      const record = features + 2 + i * 6;
      tags.push(font.toString('ascii', record, record + 4));
      const feature = features + font.readUInt16BE(record + 4);
      expect(font.readUInt16BE(feature + 2)).toBeGreaterThan(0);
      for (let j = 0; j < font.readUInt16BE(feature + 2); j++) {
        const index = font.readUInt16BE(feature + 4 + j * 2);
        const lookup = lookups + font.readUInt16BE(lookups + 2 + index * 2);
        expect(font.readUInt16BE(lookup)).toBe(1);
        expect(font.readUInt16BE(lookup + 4)).toBeGreaterThan(0);
        for (let k = 0; k < font.readUInt16BE(lookup + 4); k++) {
          const subtable = lookup + font.readUInt16BE(lookup + 6 + k * 2);
          const coverage = subtable + font.readUInt16BE(subtable + 2);
          expect([1, 2]).toContain(font.readUInt16BE(coverage));
          expect(font.readUInt16BE(coverage + 2)).toBeGreaterThan(0);
        }
      }
    }
    expect(tags.sort()).toEqual(['fina', 'init', 'medi']);
  });

  it('matches the independent font cmap union and source hashes', () => {
    const actual = new Set([9, 10, 13]);
    for (const [file, digest] of Object.entries(PLAY_CARD_FONT_SHA256)) {
      const font = readFileSync(new URL('../../../assets/fonts/' + file, import.meta.url));
      expect(createHash('sha256').update(font).digest('hex'), file + ' requires regeneration').toBe(digest);
      for (const point of cmapPoints(font)) actual.add(point);
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
  it.each(['\u03e2', '\u9ff0', '\u{1d400}', '\ud800'])('rejects uncovered glyph %s', text => {
    expect(isPlayCardTextCovered(text)).toBe(false);
  });
  it.each(['星の冒険', '별의 모험', '星际冒险', 'Звёздное приключение', 'مغامرة النجوم', '\u{2000b}', 'Title\nline'])('accepts covered text %s', text => {
    expect(isPlayCardTextCovered(text)).toBe(true);
  });
});
