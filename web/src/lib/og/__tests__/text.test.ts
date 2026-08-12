/**
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { stripPictographic, initialFor } from '../text';

// Built from codepoints rather than written literally: the OG source scan in
// `src/app/__tests__/opengraph-image.test.tsx` treats a pictographic character
// anywhere in an OG source as a failure, and this file sits under `lib/og`.
const ROCKET = String.fromCodePoint(0x1f680);
const HAMMER_AND_PICK = String.fromCodePoint(0x2692);
const SPARKLES = String.fromCodePoint(0x2728);

describe('stripPictographic', () => {
  it('removes emoji', () => {
    expect(stripPictographic(`Space ${ROCKET} Game`)).toBe('Space Game');
  });

  it('removes an astral emoji whole, leaving no lone surrogate', () => {
    const out = stripPictographic(ROCKET);
    expect(out).toBe('');
    // A naive `slice`-based strip can leave half a surrogate pair behind, which
    // is invisible in a `toBe('')` on a non-empty result but corrupts the render.
    expect([...out]).toEqual([]);
  });

  it('removes the codepoint the OG routes used to draw', () => {
    expect(stripPictographic(HAMMER_AND_PICK)).toBe('');
  });

  it('collapses the whitespace a removal leaves behind', () => {
    expect(stripPictographic(`a ${SPARKLES} b`)).toBe('a b');
    expect(stripPictographic(`${SPARKLES} lead`)).toBe('lead');
    expect(stripPictographic(`trail ${SPARKLES}`)).toBe('trail');
  });

  it('leaves ordinary typography alone', () => {
    // These are not `Extended_Pictographic`, and a coarser filter would eat them.
    const text = 'Dash — arrow → bullet • quote “x”';
    expect(stripPictographic(text)).toBe(text);
  });

  it('leaves non-Latin scripts alone', () => {
    expect(stripPictographic('ゲーム')).toBe('ゲーム');
  });

  it('returns empty for input that is entirely emoji', () => {
    expect(stripPictographic(`${ROCKET}${SPARKLES}`)).toBe('');
  });
});

describe('initialFor', () => {
  it('uppercases the first character', () => {
    expect(initialFor('ada')).toBe('A');
  });

  it('skips a leading emoji rather than sending it to the emoji CDN', () => {
    expect(initialFor(`${ROCKET}ada`)).toBe('A');
  });

  it('falls back when the name is empty, blank, or all emoji', () => {
    expect(initialFor('')).toBe('?');
    expect(initialFor('   ')).toBe('?');
    expect(initialFor(ROCKET)).toBe('?');
  });

  it('takes a non-emoji astral character whole', () => {
    // U+1D400 MATHEMATICAL BOLD CAPITAL A — outside the BMP but not emoji, so
    // `name[0]` would yield a lone high surrogate.
    const astral = String.fromCodePoint(0x1d400);
    expect(initialFor(astral)).toBe(astral.toUpperCase());
    expect([...initialFor(astral)]).toHaveLength(1);
  });

  it('honours a custom fallback', () => {
    expect(initialFor('', 'X')).toBe('X');
  });
});
