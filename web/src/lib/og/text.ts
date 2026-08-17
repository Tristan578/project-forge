/**
 * Text sanitiser for OG image routes.
 *
 * Satori routes any codepoint its emoji classifier matches through
 * `@vercel/og`'s `loadEmoji()`, which fetches from a third-party CDN — the
 * bundled font is never consulted, so no font configuration removes the
 * request. Removing the codepoints from our own sources (see `BrandMark`) only
 * covers what we wrote; the play card also renders a game title, a description
 * and a creator's initial, all of which are user-supplied.
 *
 * That route is not prerendered, so an emoji there does not break `next build`
 * — it breaks the share card at request time, and only for the games whose
 * authors happened to use one.
 *
 * The classifier is this, read out of the vendored bundle
 * (`next/dist/compiled/@vercel/og/index.node.js`), with every non-ASCII
 * codepoint spelled rather than written — this file is scanned for literal
 * emoji, comments included:
 *
 *     \p{RI}{2}|(?![#*\d](?!<FE0F>?<20E3>))
 *     \p{Emoji}(?:\p{EMod}|[\u{E0020}-\u{E007E}]+\u{E007F}|<FE0F>?<20E3>?)
 *     (?:<200D><same>)*
 *
 * It keys on `Emoji`, never on `Extended_Pictographic`, and those are not the
 * same set: `Emoji \ Extended_Pictographic` is exactly 43 codepoints — `#`,
 * `*`, `0`-`9`, the 26 regional indicators, and the 5 skin-tone modifiers.
 * Stripping only `Extended_Pictographic` therefore let flags (`\u{1F1FA}
 * \u{1F1F8}`), keycaps (`\u{0031}\u{FE0F}\u{20E3}`) and bare skin-tone
 * modifiers through, each measured reaching jsDelivr with the rest of the card
 * already sanitised.
 *
 * So the set below is `Extended_Pictographic` plus the two whole classes of
 * that difference. `#`, `*` and the digits are deliberately NOT stripped: the
 * classifier's leading lookahead excludes them unless a keycap follows, and
 * U+20E3 is removed here, so a digit can never form one.
 *
 * The last two members are joiners rather than glyphs. Neither matches on its
 * own — the classifier needs an `Emoji` base — but stripping the base of a ZWJ
 * or tag sequence strands them, and satori then resolves the leftovers through
 * Google Fonts instead. Removing them keeps that fetch away too.
 *
 * Ordinary typography is untouched: dashes, arrows, bullets, CJK and math
 * symbols are in none of these classes.
 *
 * Exported as a source string, not a `RegExp`, because the other consumer —
 * the source scan in `app/__tests__/opengraph-image.test.tsx` — needs it
 * without the `g` flag, and a shared global regex carries `lastIndex` between
 * calls. Sharing the pattern is the point: the scan previously spelled its own
 * narrower set and went blind to flags, keycaps and skin-tone modifiers, which
 * is the same defect this module was written to fix, one layer up.
 */
export const EMOJI_PATTERN =
  '\\p{Extended_Pictographic}|\\p{Emoji_Modifier}|\\p{Regional_Indicator}|[\\u{FE0F}\\u{20E3}\\u{200D}]|[\\u{E0020}-\\u{E007F}]';

const EMOJI = new RegExp(EMOJI_PATTERN, 'gu');

/** Strips emoji, then collapses the whitespace their removal can leave behind. */
export function stripEmoji(text: string): string {
  return text.replace(EMOJI, '').replace(/\s+/g, ' ').trim();
}

/**
 * The first character of `name`, uppercased, for an avatar badge.
 *
 * Returns the fallback when the name is empty, whitespace, or leads with an
 * emoji — `[...text][0]` rather than `text[0]` so a non-emoji astral character
 * (say a first initial in a script outside the BMP) is taken whole instead of
 * being split into a lone surrogate.
 */
export function initialFor(name: string, fallback = '?'): string {
  const first = [...stripEmoji(name)][0];
  return first ? first.toUpperCase() : fallback;
}

/**
 * Truncates to `max` characters, counting by codepoint.
 *
 * `slice` counts UTF-16 code units, so it can cut an astral character's
 * surrogate pair in half. The half that survives is not a character satori can
 * render, and it resolves the replacement through Google Fonts — the same class
 * of remote fetch this module exists to prevent, arriving by a different route.
 *
 * The result never exceeds `max`. Without the first guard it can: once `max` is
 * at or below the ellipsis length, `max - ellipsis.length` is zero or negative,
 * and a negative `slice` start counts from the END, so `truncateChars('abcdefghij', 2)`
 * returned twelve characters. No caller passes a `max` that small today — which
 * is exactly why it needs to be stated here rather than left to the call site.
 */
export function truncateChars(text: string, max: number, ellipsis = '...'): string {
  const ellipsisChars = [...ellipsis];
  if (max <= ellipsisChars.length) return ellipsisChars.slice(0, Math.max(0, max)).join('');
  const chars = [...text];
  if (chars.length <= max) return text;
  return chars.slice(0, max - ellipsisChars.length).join('') + ellipsis;
}
