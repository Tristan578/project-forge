/**
 * The SpawnForge badge mark, drawn as inline SVG.
 *
 * It replaces the U+2692 HAMMER AND PICK glyph the OG routes used to render.
 * (Spelled by codepoint, not written out: a pictographic character anywhere in
 * an OG source is what `opengraph-image.test.tsx` scans for, comments
 * included.) Satori classifies that codepoint as an emoji, and `@vercel/og`
 * resolves emoji through `loadEmoji()`, whose default `twemoji` provider is
 * `https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/<code>.svg` —
 * the bundled font is never consulted, so no amount of font configuration
 * removes the request.
 *
 * The static OG routes are prerendered, which put a third-party CDN on the
 * critical path of every `next build`, with no retry and no fallback: one
 * undici connect timeout (10s) and the export does not degrade, it exits.
 * Measured on CI run 31567296508, where the identical build in a sibling job
 * on the same commit passed — the dependency is deterministic even though the
 * failure is not.
 *
 * `size` is the `fontSize` the glyph was rendered at, so each badge keeps the
 * proportions it had.
 *
 * On the drawing: this is ONE closed path, not a head shape plus a handle
 * shape. The first attempt was two disjoint rectangles and it read as a paint
 * roller — a wide pill with a stub under it is a roller, a stamp or a flag
 * long before it is a hammer, and at 16px it collapsed into a blob. It was
 * caught by rendering the real component through satori at all three
 * production sizes and looking, which is the only check that can see it: every
 * assertion in `BrandMark.test.tsx` passed on the roller.
 *
 * Two properties make it survive the downscale, and both are load-bearing:
 * the outline is continuous, so nothing thin has to stay attached to anything
 * else as pixels drop out; and it is swung off the vertical, so the diagonal
 * says "tool" before any detail resolves. This is also the OG card's only
 * pictorial mark and the only icon any social platform shows for the product —
 * there is no icon in the app header or the landing nav to fall back on.
 */
export function BrandMark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32">
      <g transform="rotate(-38 16 16)">
        <path
          d="M8 3 L24 3 A3 3 0 0 1 27 6 L27 9 A3 3 0 0 1 24 12 L19.5 12 L19.5 27 A2 2 0 0 1 17.5 29 L14.5 29 A2 2 0 0 1 12.5 27 L12.5 12 L8 12 A3 3 0 0 1 5 9 L5 6 A3 3 0 0 1 8 3 Z"
          fill="#ffffff"
        />
      </g>
    </svg>
  );
}
