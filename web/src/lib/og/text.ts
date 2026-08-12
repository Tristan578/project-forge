/**
 * Text sanitiser for OG image routes.
 *
 * Satori resolves any pictographic codepoint through `@vercel/og`'s
 * `loadEmoji()`, which fetches from a third-party CDN — the bundled font is
 * never consulted, so no font configuration removes the request. Removing the
 * codepoints from our own sources (see `BrandMark`) only covers what we wrote;
 * the play card also renders a game title, a description and a creator's
 * initial, all of which are user-supplied.
 *
 * That route is not prerendered, so an emoji there does not break `next build`
 * — it breaks the share card at request time, and only for the games whose
 * authors happened to use one.
 *
 * `Extended_Pictographic` is the property satori's own emoji segmentation keys
 * on, so this strips exactly the characters that would be routed to the CDN and
 * leaves ordinary typography (dashes, arrows, bullets) alone.
 */
const PICTOGRAPHIC = /\p{Extended_Pictographic}/gu;

/** Strips emoji, then collapses the whitespace their removal can leave behind. */
export function stripPictographic(text: string): string {
  return text.replace(PICTOGRAPHIC, '').replace(/\s+/g, ' ').trim();
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
  const first = [...stripPictographic(name)][0];
  return first ? first.toUpperCase() : fallback;
}
