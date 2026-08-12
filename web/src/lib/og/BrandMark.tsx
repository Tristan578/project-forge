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
 */
export function BrandMark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32">
      {/* Head — squared on the claw side, rounded on the striking face. */}
      <path
        d="M6 5 L26 5 A3 3 0 0 1 29 8 L29 12 A3 3 0 0 1 26 15 L6 15 A1 1 0 0 1 5 14 L5 6 A1 1 0 0 1 6 5 Z"
        fill="#ffffff"
      />
      {/* Handle, set off-centre so the silhouette reads as a hammer. */}
      <rect x="9" y="15" width="4.5" height="12.5" rx="1.6" fill="#ffffff" />
    </svg>
  );
}
