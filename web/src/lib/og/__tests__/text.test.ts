/**
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { stripEmoji, initialFor, truncateChars } from '../text';

// Built from codepoints rather than written literally: the OG source scan in
// `src/app/__tests__/opengraph-image.test.tsx` treats a pictographic character
// anywhere in an OG source as a failure, and this file sits under `lib/og`.
const ROCKET = String.fromCodePoint(0x1f680);
const HAMMER_AND_PICK = String.fromCodePoint(0x2692);
const SPARKLES = String.fromCodePoint(0x2728);
const ZWJ = String.fromCodePoint(0x200d);
const VS16 = String.fromCodePoint(0xfe0f);
const KEYCAP = String.fromCodePoint(0x20e3);

describe('stripEmoji', () => {
  it('removes emoji', () => {
    expect(stripEmoji(`Space ${ROCKET} Game`)).toBe('Space Game');
  });

  it('removes an astral emoji whole, leaving no lone surrogate', () => {
    const out = stripEmoji(ROCKET);
    expect(out).toBe('');
    // A naive `slice`-based strip can leave half a surrogate pair behind, which
    // is invisible in a `toBe('')` on a non-empty result but corrupts the render.
    expect([...out]).toEqual([]);
  });

  it('removes the codepoint the OG routes used to draw', () => {
    expect(stripEmoji(HAMMER_AND_PICK)).toBe('');
  });

  it('collapses the whitespace a removal leaves behind', () => {
    expect(stripEmoji(`a ${SPARKLES} b`)).toBe('a b');
    expect(stripEmoji(`${SPARKLES} lead`)).toBe('lead');
    expect(stripEmoji(`trail ${SPARKLES}`)).toBe('trail');
  });

  // Satori's classifier keys on `Emoji`, not `Extended_Pictographic`, and the
  // difference between those two sets is 43 codepoints — every case below was
  // measured reaching jsDelivr while `Extended_Pictographic` was all we stripped.
  it('removes a regional-indicator flag, both halves', () => {
    const flag = `${String.fromCodePoint(0x1f1fa)}${String.fromCodePoint(0x1f1f8)}`;
    expect(stripEmoji(`from ${flag} here`)).toBe('from here');
  });

  it('removes an odd regional indicator that pairs with nothing', () => {
    // The classifier matches `\p{RI}{2}`, so a single one falls through to the
    // `Emoji` branch and is still resolved through the CDN on its own.
    expect(stripEmoji(String.fromCodePoint(0x1f1f8))).toBe('');
  });

  it('removes a keycap sequence entirely', () => {
    expect(stripEmoji(`level 1${VS16}${KEYCAP} done`)).toBe('level 1 done');
  });

  it('removes a bare skin-tone modifier', () => {
    expect(stripEmoji(`a${String.fromCodePoint(0x1f3fb)}b`)).toBe('ab');
  });

  it('leaves no joiner stranded by a ZWJ sequence', () => {
    // The base glyphs are pictographic and would go; the ZWJ between them is
    // not, and satori resolves a stranded one through Google Fonts instead.
    const family = `${String.fromCodePoint(0x1f468)}${ZWJ}${String.fromCodePoint(0x1f4bb)}`;
    expect(stripEmoji(`dev ${family}`)).toBe('dev');
  });

  it('leaves no tag characters stranded by a tag-sequence flag', () => {
    const tags = [0xe0067, 0xe0062, 0xe0065, 0xe006e, 0xe0067, 0xe007f]
      .map((c) => String.fromCodePoint(c))
      .join('');
    expect(stripEmoji(`${String.fromCodePoint(0x1f3f4)}${tags}wales`)).toBe('wales');
  });

  it('keeps the characters a keycap is built from', () => {
    // `#`, `*` and the digits are `Emoji` but the classifier's leading lookahead
    // excludes them unless a keycap follows — and the keycap is stripped here,
    // so one can never form. Removing them would mangle ordinary text.
    expect(stripEmoji('#1 of 10 * bonus')).toBe('#1 of 10 * bonus');
  });

  it('leaves ordinary typography alone', () => {
    // In none of the stripped classes, and a coarser filter would eat them.
    const text = 'Dash — arrow → bullet • quote “x”';
    expect(stripEmoji(text)).toBe(text);
  });

  it('leaves non-Latin scripts alone', () => {
    expect(stripEmoji('ゲーム')).toBe('ゲーム');
  });

  it('returns empty for input that is entirely emoji', () => {
    expect(stripEmoji(`${ROCKET}${SPARKLES}`)).toBe('');
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

describe('truncateChars', () => {
  it('returns short input unchanged', () => {
    expect(truncateChars('short', 120)).toBe('short');
  });

  it('returns input of exactly the limit unchanged', () => {
    const exact = 'x'.repeat(120);
    expect(truncateChars(exact, 120)).toBe(exact);
  });

  it('cuts to the limit including the ellipsis', () => {
    const out = truncateChars('x'.repeat(200), 120);
    expect(out).toBe(`${'x'.repeat(117)}...`);
    expect([...out]).toHaveLength(120);
  });

  it('counts astral characters as one, and never splits their surrogate pair', () => {
    // `slice` counts UTF-16 code units, so cutting at 117 here would land inside
    // the 59th pair and leave a lone high surrogate — which satori resolves
    // through Google Fonts, the remote fetch this module exists to prevent.
    const astral = String.fromCodePoint(0x1d400);
    const out = truncateChars(astral.repeat(200), 120);
    expect([...out]).toHaveLength(120);
    expect(out.match(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g)).toBeNull();
    expect(out.endsWith('...')).toBe(true);
  });

  it('honours a custom ellipsis', () => {
    expect(truncateChars('x'.repeat(10), 5, '…')).toBe(`${'x'.repeat(4)}…`);
  });
});
