/**
 * Shared claim patterns for the fabricated-social-proof guards (PF-1020).
 *
 * Two suites enforce the same rule against different substrates:
 *
 * - `src/app/__tests__/public-social-proof.test.ts` scans SOURCE text across
 *   every public route directory.
 * - `src/components/marketing/__tests__/LandingPage.test.tsx` scans the
 *   RENDERED text of the landing page.
 *
 * They started as hand-copied twins and drifted within one commit: the source
 * patterns were widened and the DOM pair was left behind, so the DOM copy both
 * MISSED real claims ("Join thousands of indie creators") and FIRED on innocent
 * copy (a bare `[\d,]+` matches the comma in "creators, developers"). A false
 * alarm is not harmless here — the guard's own doctrine is "remove the claim,
 * do not loosen this pattern", so a spurious hit pressures the next dev into
 * deleting correct copy or weakening the regex.
 *
 * Both suites now import from here. Edit a pattern once; both substrates move
 * together.
 */

/**
 * Claims that read the same in source and in rendered text, so both suites use
 * them unchanged.
 */
export const RENDERED_TEXT_CLAIMS: { label: string; pattern: RegExp }[] = [
  {
    label: 'unverifiable population claim ("thousands of creators")',
    // One optional intervening word so "thousands of INDIE creators" is caught.
    pattern:
      /\b(thousands|millions|hundreds|dozens) of\s+(?:\w+\s+)?(creators|developers|devs|users|studios|teams|makers|builders|customers)\b/i,
  },
  {
    label: 'bare user count ("10k+ users", "Join 5,000 creators")',
    // Must OPEN on a digit. `[\d,]+` alone matches a bare comma, which makes
    // "Built for creators, developers" a false positive.
    pattern:
      /\b\d[\d,]*\s*(?:k|m)?\+?\s+(creators|developers|devs|users|studios|teams|makers|builders|customers)\b/i,
  },
];

/**
 * Claims that only have a recognisable shape in source: attribute names and
 * JSON-LD keys never survive to rendered text.
 */
export const SOURCE_ONLY_CLAIMS: { label: string; pattern: RegExp }[] = [
  {
    label: 'trust-badge heading ("Trusted by", "Loved by")',
    pattern: /\b(trusted|loved)\s+by\b/i,
  },
  {
    label: 'review/rating structured data',
    pattern: /\b(aggregateRating|reviewCount|ratingValue)\b/,
  },
  {
    label: 'Review or AggregateRating JSON-LD',
    // Quote-agnostic on purpose. Every JSON-LD block on the public surface is
    // written with SINGLE quotes (`'@type': 'FAQPage'`), so a double-quote-only
    // pattern was dead code: it could not fire on any page it scanned, and a
    // fabricated `Review` with `author` + `reviewBody` and no rating slipped
    // past this pattern AND the rating-field one above.
    pattern: /['"]@type['"]\s*:\s*['"](Review|AggregateRating)['"]/,
  },
];

/** Every claim the source scan enforces. */
export const FABRICATED_SOCIAL_PROOF = [
  ...RENDERED_TEXT_CLAIMS,
  ...SOURCE_ONLY_CLAIMS,
];
