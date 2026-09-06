/**
 * The credential SHAPE list, and a string-only redactor over it.
 *
 * WHY THIS IS ITS OWN MODULE, and not part of `redactSecrets.ts`.
 *
 * `sentryConfig.ts` scrubs every Sentry event, and it runs in all three
 * runtimes — including the BROWSER, through `instrumentation-client.ts`. When
 * its `scrubString` was routed through `redactSecrets`, that pulled a
 * ~1,300-line server-oriented module into the client bundle: the environment
 * enumeration and its memo, the traversal with cycle and DAG detection and a
 * node budget, and two index-mapped decoders. None of it does anything in a
 * browser — there are no server environment secrets to match, and the scrub
 * target is a single string, not a tree — and it pushed the total JS bundle
 * over its hard limit, which is how it was noticed.
 *
 * So the SHAPES live here, where both sides can have them, and the heavy
 * machinery stays server-side. They are defined ONCE: `redactSecrets.ts`
 * imports this module rather than carrying a second copy, because two lists of
 * credential patterns drift and the drift is invisible until something leaks.
 *
 * `web/src/lib/monitoring/__tests__/sentry-regressions.test.ts` pins the import
 * shape, since nothing short of a build can observe a bundle edge.
 */

/**
 * Credential shapes seen in provider error bodies, or documented by the
 * provider as its key format. Ordered longest-prefix-first where prefixes
 * overlap (`sk-ant-` before `sk-`) so the more specific pattern wins.
 *
 * Each entry cites what it covers. A shape nobody has cited is a guess, and a
 * guess here is worse than nothing: it creates the impression of coverage.
 *
 * EVERY QUANTIFIER IS UPPER-BOUNDED. `sentryConfig.ts` documents that invariant
 * for its own patterns — matching must stay linear on attacker-influenced text
 * — and this module is called from `scrubString`, on exactly that input class.
 * An unbounded `{16,}` here would regress the invariant through the back door.
 */
const SECRET_SHAPES: readonly RegExp[] = [
  // Anthropic: https://docs.anthropic.com/en/api/getting-started
  /\bsk-ant-[A-Za-z0-9_-]{16,200}/g,
  // OpenAI, including the project-scoped form: https://platform.openai.com/api-keys
  // (OpenRouter's `sk-or-v1-...` matches this too.)
  //
  // A 20-character UNBROKEN run is required somewhere after the prefix, with a
  // short hyphenated segment allowed before it (`proj-`, `or-v1-`). The
  // previous form — twenty-or-more of any word character INCLUDING the hyphen
  // — fired on ordinary hyphenated text that merely begins "sk-", so
  // `sk-learn-preprocessing-module-name` became
  // `[REDACTED]`. Harmless in Sentry, but this now runs on API response
  // bodies, where silently rewriting a legitimate identifier corrupts the
  // payload with no signal.
  /\bsk-[A-Za-z0-9_-]{0,20}[A-Za-z0-9_]{20,200}[A-Za-z0-9_-]{0,200}/g,
  // ElevenLabs: `sk_` + hex. Underscore, not the hyphen OpenAI uses — the
  // hyphenated pattern above cannot match it, which is why elevenlabs (one of
  // the three providers whose bodies caused #9736) had no cover at all.
  // https://elevenlabs.io/docs/api-reference/authentication
  /\bsk_[0-9a-fA-F]{32,64}\b/g,
  // Meshy: `msy_` + token. https://docs.meshy.ai/api/authentication
  /\bmsy_[A-Za-z0-9]{16,200}/g,
  // Stripe secret and restricted keys, live and test: https://docs.stripe.com/keys
  // Clerk's `sk_live_`/`sk_test_` keys share this shape.
  /\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,200}/g,
  // Stripe webhook signing secret: https://docs.stripe.com/webhooks
  /\bwhsec_[A-Za-z0-9]{16,200}/g,
  // Replicate: https://replicate.com/account/api-tokens
  /\br8_[A-Za-z0-9]{20,200}/g,
  // GitHub classic tokens: https://docs.github.com/en/authentication
  /\bgh[pousr]_[A-Za-z0-9]{20,200}/g,
  // GitHub fine-grained PATs, which do NOT match the classic shape above.
  // `GITHUB_MODELS_PAT` is one of this deployment's own variables.
  /\bgithub_pat_[A-Za-z0-9_]{20,200}/g,
  // Any bearer credential, whatever the token's shape. Catches an upstream
  // echoing back the Authorization header it was sent, and is the ONLY shape
  // cover for suno and hyper3d BYOK keys, which have no documented prefix.
  /\bBearer\s{1,8}[A-Za-z0-9._~+/=-]{12,400}/g,
  // Connection strings carry a password in the userinfo segment.
  //
  // THE CLASSES ADMIT `"`, AND THAT IS DELIBERATE. An earlier version excluded
  // it and claimed the exclusion "costs no coverage". That was false, and
  // measured false: a password containing a quote — which reaches a parsed leaf
  // as a literal `"` — stopped matching entirely, so
  //     {"error":"connect failed: postgres://appuser:hun\"ter2pw@host:5432/db"}
  // went out verbatim, password intact, at both 200 and 500, while the same DSN
  // without the quote was redacted. The justification was inverted as well:
  // `%22` is caught by the RAW view, not the decoded one, since the decoded view
  // holds a literal quote and could not match either.
  //
  // The exclusion existed because this shape can STRADDLE JSON string
  // boundaries — in `{"a":"https://x","b":"y@z"}` the serialised bytes read as
  // scheme `https`, userinfo `x","b`, the `:` from the next key's separator, and
  // an `@` from a later field — which once turned the public gallery into a 500
  // for every visitor. That is fixed where it belongs, in `egressGuard.ts`:
  // `bodyStillHasCandidate` verifies per leaf, so a match no leaf contains
  // cannot fail closed, and `redactBufferedBody` returns the original bytes when
  // no leaf changed, so a false positive costs one parse rather than a corrupted
  // response. Narrowing a credential pattern to work around a verification bug
  // traded real coverage for a fix that was already in the right place.
  /\b[a-zA-Z][a-zA-Z0-9+.-]{0,20}:\/\/[^\s:/@]{1,100}:[^\s@]{1,200}@[^\s]{1,300}/g,
];

/**
 * Shapes applied ONLY where the text is diagnostic — an error body, or a Sentry
 * event. They are excluded from a SUCCESS body, because on this surface the
 * credential they describe is one the product deliberately shows the user once.
 *
 * `forge_` is the whole list, and it carries two corrections at once:
 *
 *  - The pattern was `/\bforge_[0-9a-f]{32}\b/g` and could NEVER match. The
 *    route it cites mints `forge_${randomBytes(32).toString('hex')}` — 32
 *    BYTES, which is 64 hex characters. `{32}` cannot backtrack, so the 33rd
 *    hex character defeats the trailing `\b` and the match always failed. It
 *    was listed as coverage while providing none (lessons-learned #11), for the
 *    one credential class this module can name with certainty.
 *  - Correcting it to `{64}` is not enough on its own, because
 *    `POST /api/keys/api-key` returns `key: rawKey` in its 200 body for the
 *    one-time display that is the entire point of creating a key. A shape that
 *    fired there would redact the key out of the response and break the API
 *    Keys UI — the same class of harm as the depth bound above.
 *
 * So the shape is corrected AND scoped: it fires on status >= 400 and in Sentry,
 * where a `forge_` key appearing in text is always a leak, and never on a 2xx
 * body, where it is the product working. `withEgressGuard` picks the set from
 * the response status; `redactSecrets` (the Sentry path) always includes it.
 */
const SELF_ISSUED_SHAPES: readonly RegExp[] = [
  // SpawnForge's own API keys — `forge_` + 64 hex (web/src/app/api/keys/api-key/route.ts:49).
  /\bforge_[0-9a-f]{64}\b/g,
];

/**
 * The alternation, built once. Two of them, because `SELF_ISSUED_SHAPES` is
 * scoped to diagnostic text (see its comment above).
 *
 * Derived from the arrays rather than written out, so the cited,
 * individually-reviewed patterns stay the source of truth and the
 * bounded-quantifier test still scans what is actually used.
 */
const ALL_SECRET_SHAPES = new RegExp(SECRET_SHAPES.map((s) => s.source).join('|'), 'g');
const ALL_SECRET_SHAPES_WITH_SELF_ISSUED = new RegExp(
  [...SECRET_SHAPES, ...SELF_ISSUED_SHAPES].map((s) => s.source).join('|'),
  'g',
);

/** The alternation a caller should use. Chosen once, not per string. */
export function shapesFor(includeSelfIssued: boolean): RegExp {
  return includeSelfIssued ? ALL_SECRET_SHAPES_WITH_SELF_ISSUED : ALL_SECRET_SHAPES;
}

/** What a removed value is replaced with. Stable so tests and greps can pin it. */
export const REDACTION_PLACEHOLDER = '[REDACTED]';

/**
 * Replace every credential SHAPE in one string.
 *
 * This is the whole of what a browser can usefully do. It does not look at the
 * environment (a browser has no server secrets), does not walk a structure, and
 * does not decode percent- or JSON-escaped spellings — `redactSecrets` on the
 * server does all of that. Shape matching is the half that protects a Sentry
 * event carrying a freshly-minted key, which is the client-side risk the Sentry
 * configuration is guarding against.
 */
export function redactShapeText(input: string, includeSelfIssued = true): string {
  const shapes = shapesFor(includeSelfIssued);
  shapes.lastIndex = 0;
  return input.replace(shapes, REDACTION_PLACEHOLDER);
}

export { SECRET_SHAPES, SELF_ISSUED_SHAPES };
