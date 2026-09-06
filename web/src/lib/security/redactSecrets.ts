/**
 * Last-line redaction for strings that are about to leave this process.
 *
 * WHY THIS EXISTS (#9736). The provider clients under `lib/generate/` fold the
 * upstream **response body** verbatim into the thrown error:
 *
 *     const error = await response.text().catch(() => 'Unknown error');
 *     throw new Error(`Meshy status error (${response.status}): ${error}`);
 *
 * and twelve routes returned that error's `message` to the caller. On the
 * platform path the credential in play is the PLATFORM's, not the user's, so a
 * provider that echoes key material in an auth-failure body hands a platform
 * secret to any signed-in user. Relying on a third party's redaction policy is
 * the wrong dependency: it can change without notice and we would not know.
 *
 * WHERE THIS ACTUALLY RUNS, stated precisely because two earlier versions of
 * this comment overstated it.
 *
 * It runs on EVERY API response, because `withEgressGuard`
 * (`src/lib/security/egressGuard.ts`) wraps every App Router handler and calls
 * this module on the body, on every header value, on every `Set-Cookie` and on
 * the `Location` before the response is returned. That is what makes the
 * sentence "redaction is on the response path" true, and it is true whatever
 * the route did — no static analysis has to predict the shape.
 *
 * The first version of this comment claimed the catch path was covered because
 * routes used the constructors in `lib/api/errors.ts`; 89 of 101 route files
 * used a raw `NextResponse.json` instead, so the net sat under about 1% of the
 * API surface, including none of the routes that had the defect. The second
 * credited the lint rule `spawnforge/no-raw-response-in-catch`, which three
 * review passes then walked around one alias at a time. The rule is kept as
 * early feedback; the guard is what carries the property.
 *
 * It also runs inside the Sentry scrubbers, because provider text reaches a
 * third party too.
 *
 * TWO MECHANISMS, with different reach — and the difference matters:
 *
 *  - VALUE matching removes anything in this process's environment whatever its
 *    shape, including a provider added tomorrow whose key format nobody here
 *    has seen. It is the general half, and it is SERVER-ONLY: `sentryConfig` is
 *    imported by `instrumentation-client.ts`, and in the browser bundle Next.js
 *    substitutes only literal `process.env.NEXT_PUBLIC_*` member expressions,
 *    so an enumeration of `process.env` there sees an empty object. Client-side
 *    this half is inert by construction.
 *
 *  - SHAPE matching is the only cover for a credential this process never
 *    holds — a user's own BYOK key quoted back inside a provider's error body,
 *    since BYOK keys live encrypted in the database and never in `process.env`.
 *    It reaches only the shapes listed below. Of the five BYOK providers
 *    (`BYOK_PROVIDERS` in `lib/config/providers.ts`) it covers anthropic,
 *    meshy and elevenlabs by documented prefix; **suno and hyper3d publish no
 *    distinctive key prefix, so a BYOK key for either is covered only if it
 *    appears behind `Bearer `**. That is a real gap, and naming it is better
 *    than a guessed pattern that would read as coverage.
 *
 * Redaction is a net, not a licence, and the net has a specific hole: it
 * removes environment values and the credential shapes listed below, and it
 * cannot recognise an internal hostname, a SQL fragment, or another tenant's
 * identifier. Routes must still return fixed strings on the error path. The
 * guard is what catches what nobody predicted; it is not permission to stop
 * trying.
 */

/** What a removed value is replaced with. Stable so tests and greps can pin it. */
export const REDACTION_PLACEHOLDER = '[REDACTED]';

/**
 * What a CYCLE is replaced with. A structure that points back at itself cannot
 * be serialised at all — `JSON.stringify` throws on one — so replacing the
 * second visit is the only representable answer. It is NOT a truncation of data
 * a caller could otherwise have received.
 *
 * There is deliberately no depth placeholder any more; see `MAX_REDACTION_NODES`.
 */
export const CIRCULAR_PLACEHOLDER = '[REDACTED: circular reference]';

/**
 * Environment variables whose VALUES must never appear in outbound text.
 *
 * Name-based, because the set of secrets grows and a hardcoded list would rot.
 * `NEXT_PUBLIC_*` is excluded on purpose: Next.js inlines those into the client
 * bundle, so they are public by construction and redacting them would corrupt
 * legitimate output while protecting nothing.
 *
 * NOT suffix-anchored. The previous `(_KEY|_SECRET|...)$` form missed real
 * variables this deployment receives: `GITHUB_MODELS_PAT` and
 * `ASSET_R2_ACCESS_KEY_ID` (this repo's own), and `PGPASSWORD`, `POSTGRES_URL`,
 * `DATABASE_URL_UNPOOLED` and `AWS_SECRET_ACCESS_KEY` (injected by Neon, Vercel
 * and AWS). `redactSecrets.test.ts` pins the real names against this pattern.
 *
 * The trade-off is deliberate: `STRIPE_PRICE_TOKEN_SPARK` matches on the word
 * TOKEN, so its price id would be redacted out of an error string. Over-
 * redacting a price id costs a line of diagnostics; under-redacting a
 * credential is the bug this file exists for.
 */
const SECRET_NAME_PATTERN =
  /(PASSWORD|PASSWD|SECRET|TOKEN|CREDENTIAL|PRIVATE|SIGNING|DATABASE_URL|POSTGRES_URL|CONNECTION_STRING)|(^|_)(KEY|KEYS|PAT|DSN|SALT|PWD)(_|$)/;

/**
 * Names that the pattern above catches on the word KEY but which hold a PUBLIC
 * IDENTIFIER, not a credential — and which this deployment puts into text a
 * client is supposed to receive.
 *
 * `ASSET_R2_ACCESS_KEY_ID` is the concrete one. `getSignedDownloadUrl`
 * (`lib/storage/r2.ts`) mints an AWS SigV4 URL whose query string embeds the
 * access key id verbatim as `X-Amz-Credential=<AKID>/<date>/auto/s3/aws4_request`,
 * and `/api/marketplace/assets/[id]/download` returns that URL as a `Location`.
 * Redacting it rewrites the signed URL, R2 answers 403 InvalidAccessKeyId, and
 * every paid asset download silently fails — a control breaking the product it
 * is protecting. The paired SECRET (`ASSET_R2_SECRET_ACCESS_KEY`,
 * `AWS_SECRET_ACCESS_KEY`) still matches on SECRET and is still removed; SigV4
 * exists precisely so the id can travel in the clear while the secret never does.
 *
 * Anchored to `_KEY_ID` at the END of the name so it exempts an identifier and
 * nothing else: `ASSET_R2_ACCESS_KEY_ID`, `AWS_ACCESS_KEY_ID`, `..._KEY_ID` —
 * never `..._KEY_ID_SECRET` or a bare `..._KEY`.
 */
const PUBLIC_IDENTIFIER_NAME_PATTERN = /(^|_)KEY_ID$/;

/**
 * Values shorter than this are ignored. A secret-named variable set to
 * something short — a flag, a mode, an accidental placeholder — would otherwise
 * turn every occurrence of that substring in ordinary prose into a placeholder,
 * which corrupts diagnostics without protecting anything real. No credential
 * worth protecting is this short.
 */
const MIN_REDACTABLE_LENGTH = 12;

/**
 * The bound on traversal, and WHY IT IS COUNTED IN NODES RATHER THAN DEPTH.
 *
 * This used to be `MAX_DEPTH = 8`, and past it the sub-tree was replaced with a
 * placeholder string. That was a correct fail-closed choice for the ERROR path
 * this module was written for, where truncating a diagnostic costs nothing.
 * `withEgressGuard` then moved it onto every 200 body, and there it was
 * catastrophic: at `{game:{sceneData:{entities:[{...}]}}}` an entity sits at
 * depth 4, so a tilemap layer's `tiles`, a skeleton bone's `localPosition` and
 * an animation track's `keyframes` all land at depth 8 and were replaced by a
 * STRING. The player's deserialisation of a published game fails outright, the
 * editor PUTs the truncated scene back, and `/api/user/export-data` hands the
 * user a GDPR export with holes in it. Silently — no status change, no log.
 *
 * That is lessons-learned #1: a control that asserts the right property on its
 * old path and the wrong one on its new path. Depth is not the hazard; total
 * work is. So:
 *
 *  - DEPTH IS UNBOUNDED. Nesting never destroys data.
 *  - CYCLES are caught by identity (`seen`), not by depth, and replaced with
 *    `CIRCULAR_PLACEHOLDER` — the only representable answer for a structure
 *    `JSON.stringify` would itself refuse.
 *  - TOTAL NODES are bounded, so a pathological input cannot pin a request. Past
 *    the bound the traversal THROWS rather than returning a truncated value, so
 *    the caller FAILS CLOSED (`withEgressGuard` returns its fixed 500) instead
 *    of emitting a corrupted body as if it were the real one.
 *
 * The number: the largest realistic body on this surface is a published scene.
 * The committed fixture for one (`__tests__/deepSceneBody.ts` at its default
 * 400 entities, the body `web/scripts/bench-egress-guard.ts` measures) is
 * 349,983 bytes and walks 38,412 nodes. An earlier version of this comment said
 * "~190 KB / ~34k nodes (`scripts/bench-egress-guard.mjs`)" — a file that does
 * not exist, and a size the harness in this same change measures at nearly
 * double. Both numbers are now asserted rather than asserted-about:
 * `redactSecrets.test.ts` drives that fixture through a pass and checks
 * `lastNodeCount()` against this constant, so the headroom claim below fails
 * when the body grows instead of quietly becoming false (lessons-learned #8).
 *
 * 2,000,000 is ~52x that node count and still bounds the walk at well under a
 * second, so it is a backstop against a hostile shape rather than a ceiling any
 * real payload approaches.
 */
export const MAX_REDACTION_NODES = 2_000_000;

/**
 * Thrown when a traversal exceeds `MAX_REDACTION_NODES`. Named so a caller can
 * tell "this input is pathological" apart from "the redactor has a bug", and so
 * the guard can fail closed on it deliberately rather than by accident.
 */
export class RedactionBudgetExceededError extends Error {
  constructor(nodes: number) {
    super(`redaction traversal exceeded ${nodes} nodes`);
    this.name = 'RedactionBudgetExceededError';
  }
}

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

// ---------------------------------------------------------------------------
// Environment value list, memoised
// ---------------------------------------------------------------------------

/**
 * Deriving this list costs ~0.3 ms: enumerating `process.env` allocates an
 * entry array per key, every name is regex-tested, and the survivors are
 * sorted. The previous version paid that on EVERY string leaf, so one Sentry
 * event with 300 strings burned ~90 ms of synchronous CPU inside `beforeSend`,
 * and because `scrubMetric` routes through here it ran on the SUCCESS path of
 * every generation request too.
 *
 * Two changes, and correctness is preserved by the second:
 *  - the list is derived once per `redactSecrets()` call and threaded through
 *    the recursion, so leaf count no longer multiplies the cost;
 *  - it is memoised across calls behind a fingerprint. A cache with no
 *    invalidation would be the "protection that quietly stopped applying"
 *    failure this module exists to prevent, so the fingerprint checks BOTH the
 *    number of environment keys (catches a variable added or removed) AND the
 *    current value of every name already in the cache (catches a value replaced
 *    in place — which is what `vi.stubEnv` does to a variable that is already
 *    set).
 *
 * What the fingerprint costs, stated precisely, because the first version of
 * this comment claimed "no allocation" and was wrong: the key-count check IS an
 * enumeration — `Object.keys(process.env)` allocates one array of ~100 strings.
 * What the memo removes is the per-call regex test of every name and the sort,
 * which is the ~0.3 ms. The value check is a direct read per cached name, no
 * allocation.
 *
 * And note where this runs. `sentryConfig.ts`'s `scrubString` calls
 * `redactSecrets` on every string LEAF, so the fingerprint — enumeration
 * included — runs once per leaf, not once per event. An event with 300 strings
 * pays 300 enumerations and ONE derive, where it used to pay 300 derives.
 */
interface EnvSecretCache {
  /** Secret-named variables, in enumeration order. */
  names: string[];
  /** Their values, index-aligned with `names`, for the fingerprint check. */
  values: string[];
  /** The same values sorted longest-first, which is what redaction consumes. */
  sorted: string[];
  /** Total number of environment keys when the cache was built. */
  keyCount: number;
}

let envCache: EnvSecretCache | null = null;

/**
 * Drop the memoised environment list. Exported for tests that need to prove an
 * assertion does not pass merely because the cache was warm; ordinary callers
 * never need it, because the fingerprint below already invalidates on any
 * relevant change.
 */
export function resetSecretEnvCache(): void {
  envCache = null;
}

function cacheIsCurrent(cache: EnvSecretCache): boolean {
  if (Object.keys(process.env).length !== cache.keyCount) return false;
  for (let i = 0; i < cache.names.length; i += 1) {
    if (process.env[cache.names[i]] !== cache.values[i]) return false;
  }
  return true;
}

function buildEnvCache(): EnvSecretCache {
  const names: string[] = [];
  const values: string[] = [];
  let keyCount = 0;
  for (const [name, value] of Object.entries(process.env)) {
    keyCount += 1;
    if (!value || value.length < MIN_REDACTABLE_LENGTH) continue;
    if (name.startsWith('NEXT_PUBLIC_')) continue;
    if (PUBLIC_IDENTIFIER_NAME_PATTERN.test(name)) continue;
    if (!SECRET_NAME_PATTERN.test(name)) continue;
    names.push(name);
    values.push(value);
  }
  // Longest first: if one secret is a substring of another, removing the longer
  // one first prevents a partial redaction that leaves the tail exposed.
  const sorted = [...values].sort((a, b) => b.length - a.length);
  return { names, values, sorted, keyCount };
}

/** The environment values to remove. See `EnvSecretCache` for the memo contract. */
function secretEnvValues(): string[] {
  try {
    if (envCache && cacheIsCurrent(envCache)) return envCache.sorted;
    envCache = buildEnvCache();
    return envCache.sorted;
  } catch {
    // "Never throws" is a promise this module makes, and it runs on the error
    // path — a redactor that throws turns a handled failure into an unhandled
    // one. Losing the value half is strictly better than that; the shape half
    // still applies.
    return [];
  }
}

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

/**
 * What one redaction pass carries: the environment values to remove, and
 * whether to look through percent-encoding as well as at the literal text.
 */
interface RedactionContext {
  envValues: readonly string[];
  /**
   * Also match against a percent-DECODED view of each string, splicing the
   * placeholder back into the original at the mapped offsets.
   *
   * Off for ordinary structured data. ON for anything that has been through URL
   * or cookie encoding, because every credential shape here is left-anchored
   * with a word boundary and percent-encoding destroys it: in
   * `...invalid%20key%20sk-ant-AAA...` the character before `sk-ant-` is the
   * `0` of `%20`, which is a word character, so the boundary never matches and
   * the key passes through verbatim. That is not hypothetical — it is how a
   * redirect `Location` and a `Set-Cookie` value are actually written, and both
   * emitted the secret unredacted until this existed.
   */
  percentAware: boolean;
  /**
   * The shape alternation this pass uses — with or without `SELF_ISSUED_SHAPES`.
   * Carried on the context rather than read from a module constant so the
   * fast-path SCAN and the redaction that follows it can never disagree about
   * what counts as a match.
   */
  shapes: RegExp;
}

const HEX_PAIR = /^[0-9a-fA-F]{2}$/;

/**
 * The shapes as ONE alternation, so a string is scanned once instead of
 * thirteen times.
 *
 * This runs on every string leaf of every API response now that
 * `withEgressGuard` sits on the response path, and thirteen separate passes
 * over a 13 KB listing body measured at ~1.1 ms of added latency per request —
 * most of it the repeated scanning, not the matching. Alternation preserves the
 * array's precedence exactly: a JS regex tries alternatives left to right at
 * each position, which is the same "longest-prefix-first where prefixes
 * overlap" ordering the array documents (`sk-ant-` before `sk-`).
 *
 * Derived from `SECRET_SHAPES` rather than written out, so the cited,
 * individually-reviewed patterns stay the source of truth and the
 * bounded-quantifier test still scans the thing that is actually used.
 *
 * Two of them, because `SELF_ISSUED_SHAPES` is scoped to diagnostic text (see
 * its comment). A context carries whichever one applies.
 */
const ALL_SECRET_SHAPES = new RegExp(SECRET_SHAPES.map((s) => s.source).join('|'), 'g');
const ALL_SECRET_SHAPES_WITH_SELF_ISSUED = new RegExp(
  [...SECRET_SHAPES, ...SELF_ISSUED_SHAPES].map((s) => s.source).join('|'),
  'g',
);

/** The alternation a pass should use. Exported shape set is chosen once, not per string. */
function shapesFor(includeSelfIssued: boolean): RegExp {
  return includeSelfIssued ? ALL_SECRET_SHAPES_WITH_SELF_ISSUED : ALL_SECRET_SHAPES;
}

function redactLiteral(input: string, ctx: RedactionContext): string {
  let out = input;
  for (const value of ctx.envValues) {
    // `split`/`join`, not a RegExp: the value is arbitrary and may contain
    // regex metacharacters. Compiling it as a pattern would both fail to match
    // the real secret and redact unrelated text that happened to match.
    //
    // `includes` first: `split` allocates an array even when there is no match,
    // and on the response path there is no match on the overwhelming majority
    // of leaves.
    if (out.includes(value)) out = out.split(value).join(REDACTION_PLACEHOLDER);
  }
  ctx.shapes.lastIndex = 0;
  return out.replace(ctx.shapes, REDACTION_PLACEHOLDER);
}

/**
 * A percent-decoded view of `raw`, plus an index map: `map[i]` is the offset in
 * `raw` at which decoded character `i` begins, with a final entry of
 * `raw.length`. That is what lets a match found in decoded space be cut out of
 * the ORIGINAL string, leaving the surrounding encoding exactly as it was —
 * re-encoding the whole value would rewrite bytes this module has no business
 * touching (a `Set-Cookie`'s `; Path=/` is not URL-encoded, for one).
 *
 * Bytes >= 0x80 are deliberately left as their literal `%XX` text rather than
 * assembled into a UTF-8 code point: every credential shape here is ASCII, and
 * decoding multi-byte sequences would make the offset map lossy for no gain.
 */
function decodeWithMap(raw: string): { decoded: string; map: number[] } {
  const chars: string[] = [];
  const map: number[] = [];
  let i = 0;
  while (i < raw.length) {
    if (raw[i] === '%' && i + 2 < raw.length && HEX_PAIR.test(raw.slice(i + 1, i + 3))) {
      const byte = Number.parseInt(raw.slice(i + 1, i + 3), 16);
      if (byte < 0x80) {
        chars.push(String.fromCharCode(byte));
        map.push(i);
        i += 3;
        continue;
      }
    }
    chars.push(raw[i]);
    map.push(i);
    i += 1;
  }
  map.push(raw.length);
  return { decoded: chars.join(''), map };
}

/** Half-open `[start, end)` ranges to remove, in DECODED-space indices. */
function matchRanges(decoded: string, ctx: RedactionContext): [number, number][] {
  const ranges: [number, number][] = [];
  for (const value of ctx.envValues) {
    let from = 0;
    for (;;) {
      const at = decoded.indexOf(value, from);
      if (at === -1) break;
      ranges.push([at, at + value.length]);
      from = at + value.length;
    }
  }
  ctx.shapes.lastIndex = 0;
  for (;;) {
    const m = ctx.shapes.exec(decoded);
    if (m === null) break;
    ranges.push([m.index, m.index + m[0].length]);
    if (m[0].length === 0) ctx.shapes.lastIndex += 1;
  }
  ctx.shapes.lastIndex = 0;
  return ranges;
}

/**
 * Cut RAW-space `ranges` out of `raw`, each replaced by the placeholder.
 * Overlaps are merged and the splices run back-to-front so earlier offsets stay
 * valid. Shared by both decoded-view rewrites so they cannot splice differently.
 */
function spliceRanges(raw: string, ranges: [number, number][]): string {
  if (ranges.length === 0) return raw;
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const [start, end] of ranges) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  let out = raw;
  for (let i = merged.length - 1; i >= 0; i -= 1) {
    const [start, end] = merged[i];
    out = out.slice(0, start) + REDACTION_PLACEHOLDER + out.slice(end);
  }
  return out;
}

/**
 * Where a view offset sits in the string it was decoded FROM. Half-open ranges
 * found in a decoded view are translated through one of these, which is what
 * lets the placeholder be spliced into the ORIGINAL bytes rather than into a
 * re-encoding of them.
 *
 * A FUNCTION, not an array, because the two decoders have very different
 * densities. Percent-decoding builds one entry per character and can afford to
 * (it only runs on a string containing `%`); JSON-unescaping runs on any string
 * containing a backslash, which includes a 350 KB scene whose script source has
 * one — building 350,000 entries there cost +23.8 ms against the +5.0 ms the
 * slice-based decoder pays, so that one computes offsets from a table of escape
 * SITES instead. Both satisfy the same contract, including the sentinel:
 * `map(view.length)` is the source's length.
 */
type IndexMap = (viewIndex: number) => number;

/** Translate view-space ranges into RAW-space through an index map. */
function toRawRanges(ranges: [number, number][], map: IndexMap): [number, number][] {
  return ranges.map(([start, end]) => [map(start), map(end)] as [number, number]);
}

/**
 * Compose two index maps. `outer` maps view-A offsets into RAW; `inner` maps
 * view-B offsets into view A. The result maps view-B offsets into RAW, which is
 * what lets a match visible only after BOTH decodings be cut out of the original
 * string. The sentinel composes correctly because `inner(viewB.length)` is
 * `viewA.length` and `outer(viewA.length)` is `raw.length`.
 */
function composeMaps(outer: IndexMap, inner: IndexMap): IndexMap {
  return (i) => outer(inner(i));
}

/** An array-backed map, for a decoder that produces one entry per character. */
function arrayMap(map: number[]): IndexMap {
  return (i) => map[i];
}

/**
 * Remove anything that only becomes visible once percent-escapes are resolved.
 * Runs AFTER `redactLiteral`, so a secret written plainly is already gone and
 * this pass only has to catch the encoded spelling of one.
 */
function redactPercentEncoded(raw: string, ctx: RedactionContext): string {
  if (!raw.includes('%')) return raw;
  const { decoded, map } = decodeWithMap(raw);
  if (decoded === raw) return raw;
  return spliceRanges(raw, toRawRanges(matchRanges(decoded, ctx), arrayMap(map)));
}

/** The two-character JSON escapes, and what each stands for. */
const SIMPLE_JSON_ESCAPES = new Map<string, string>([
  ['"', '"'],
  ['\\', '\\'],
  ['/', '/'],
  ['b', '\b'],
  ['f', '\f'],
  ['n', '\n'],
  ['r', '\r'],
  ['t', '\t'],
]);

const HEX_QUAD = /^[0-9a-fA-F]{4}$/;

/**
 * A JSON-UNESCAPED view of `raw`, and the reason the fast path is sound at all.
 *
 * `hasCandidate` is handed a SERIALISED body; `redactValue` runs on the PARSED
 * leaves. Those are different string spaces, and the difference is not cosmetic:
 * on the wire a newline inside a leaf is backslash-then-`n`, and `n` is a word
 * character, so the `\b` every credential shape is left-anchored on cannot
 * match. A provider error folded into a message as
 * `"Meshy status error (401): Unauthorized\nmsy_… is not valid"` therefore
 * scanned CLEAN while `redactString` on the parsed leaf matched — the guard
 * granted byte identity and shipped the credential, which is exactly the leak
 * #9736 exists for. The environment half failed the same way: `includes` was
 * run on escaped bytes, so any secret containing a quote, a backslash or a
 * newline (any PEM `*_PRIVATE_KEY`, a `PGPASSWORD` with a quote — both selected
 * by `SECRET_NAME_PATTERN`) was never found on the wire and always found after
 * parse.
 *
 * Decoding the whole text — not each leaf, which would require the parse the
 * fast path exists to avoid — restores every leaf and every KEY verbatim
 * somewhere inside the view, because `JSON.stringify` escapes exactly `"`, `\`,
 * the five short control escapes and `\uXXXX`, all of which this reverses. The
 * characters a leaf gains around it in the view (`"`, `,`, `{`, `[`) are
 * non-word, so a `\b` that held inside the leaf still holds inside the view: the
 * scan can gain matches, never lose them.
 *
 * Applied to text that is NOT JSON (a `text/plain` body, a header value) this
 * may invent characters that were never there — `C:\new` reads as a newline.
 * That is over-approximation in the safe direction, and the RAW scan runs first
 * and independently, so nothing that matched before can stop matching.
 *
 * WHAT IT COSTS, measured rather than assumed (`scripts/bench-egress-guard.ts`,
 * Node 24.5.0, win32 x64, Ryzen 7 3800X, 200 iterations after 30 warmup, all
 * three figures from ONE session so the comparison is not across machines —
 * lessons-learned #8):
 *
 *   - a 350 KB scene with NO backslash anywhere: +3.044 ms, against +2.777 ms
 *     for the same body before this view existed. Unchanged within noise — the
 *     whole view costs one `indexOf` that finds nothing, which is the
 *     overwhelming majority of bodies.
 *   - the same scene with escapes in one script source: +5.238 ms against
 *     +4.997 ms. Roughly double the no-escape figure, because the body is
 *     copied once and scanned a second time.
 *
 * That second figure is a real cost on a real body and is stated rather than
 * buried. It is inherent to scanning what the rewrite sees: a match hidden by
 * an escape can only be found by looking at decoded text. It could be narrowed
 * to windows around escape SITES (a match that the raw scan missed must contain
 * a decoded character), which is a worthwhile optimisation and a new place for
 * an off-by-one to become a leak — so it is named here, not taken, and the
 * straightforward whole-view scan is what ships.
 *
 * IT NOW YIELDS AN INDEX MAP, AND THAT IS THE POINT. The first version returned
 * only the decoded STRING, and only the scan ever called it: `redactString` was
 * `redactLiteral` + `redactPercentEncoded`, so percent-encoding got a scan AND
 * an index-mapped rewrite while JSON escaping got a scan only. Every text-mode
 * path in the guard — the malformed-JSON fallback, a non-JSON buffered body, a
 * header value, a `Set-Cookie`, the reason phrase — therefore set
 * `hasCandidate`, left the fast path, rewrote NOTHING and emitted the
 * credential. Detect-then-emit is worse than either half alone: it pays the slow
 * path and reports a rewrite that did not happen. ONE function now feeds both
 * `textHasCandidate` and `redactJsonEscaped`, so a future change cannot teach
 * one of them a decoding and not the other.
 *
 * THE MAP IS A TABLE OF ESCAPE SITES, NOT ONE ENTRY PER CHARACTER, and that is a
 * measured decision rather than a stylistic one. `decodeWithMap` (percent) can
 * afford a per-character array because it only runs on a string containing `%`;
 * this runs on any string containing a backslash, which includes a 350 KB scene
 * whose script source has one. A per-character version of this function measured
 * +23.847 ms on that body against the +4.997 ms the slice-based decoder pays —
 * a 4.8x regression on the FAST path, for a map that is consulted only where a
 * match is found. So the decode stays slice-and-concatenate, and `rawIndexIn`
 * recovers any offset by binary search over the escape sites.
 *
 * Returns `null` when there is nothing to decode — no backslash at all, or no
 * backslash that begins a valid escape. Callers treat that as "this view is the
 * raw text", which is why neither has to compare strings to find out.
 */
interface UnescapedView {
  decoded: string;
  /** DECODED-space offset of each escape, ascending. */
  sites: number[];
  /** Raw characters consumed IN EXCESS of one, cumulative through `sites[i]`. */
  cumulativeExtra: number[];
}

function jsonUnescapeWithMap(raw: string): UnescapedView | null {
  let at = raw.indexOf('\\');
  if (at === -1) return null;
  let out = '';
  let copied = 0;
  let extra = 0;
  const sites: number[] = [];
  const cumulativeExtra: number[] = [];
  while (at !== -1) {
    const next = at + 1 < raw.length ? raw[at + 1] : '';
    const simple = SIMPLE_JSON_ESCAPES.get(next);
    let decoded: string | null = null;
    let width = 0;
    if (simple !== undefined) {
      decoded = simple;
      width = 2;
    } else if (next === 'u' && at + 6 <= raw.length && HEX_QUAD.test(raw.slice(at + 2, at + 6))) {
      decoded = String.fromCharCode(Number.parseInt(raw.slice(at + 2, at + 6), 16));
      width = 6;
    }
    if (decoded === null) {
      // Not a JSON escape. Leave both characters alone and keep looking.
      at = raw.indexOf('\\', at + 1);
      continue;
    }
    out += raw.slice(copied, at) + decoded;
    // `extra` still holds what PREVIOUS escapes consumed, so this escape's
    // decoded offset is its raw offset less that.
    sites.push(at - extra);
    extra += width - 1;
    cumulativeExtra.push(extra);
    copied = at + width;
    at = raw.indexOf('\\', copied);
  }
  if (sites.length === 0) return null;
  return { decoded: out + raw.slice(copied), sites, cumulativeExtra };
}

/**
 * The RAW offset at which decoded character `i` begins, and `raw.length` for the
 * sentinel `i === decoded.length` — the same contract `decodeWithMap`'s array
 * satisfies, computed rather than stored.
 *
 * Every escape at a decoded offset strictly BELOW `i` pushed `i` further along
 * the raw string, so the answer is `i` plus what those escapes consumed in
 * excess of one character each. Binary search finds how many there are.
 */
function rawIndexIn(view: UnescapedView, i: number): number {
  let lo = 0;
  let hi = view.sites.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (view.sites[mid] < i) lo = mid + 1;
    else hi = mid;
  }
  return i + (lo > 0 ? view.cumulativeExtra[lo - 1] : 0);
}

/**
 * The REWRITE half of what `textHasCandidate` scans for: remove anything that
 * only becomes visible once JSON escapes are resolved, splicing the placeholder
 * back into the RAW string at mapped offsets so the surrounding text keeps its
 * own escaping byte for byte.
 *
 * Unconditional, not gated on `percentAware`, because the SCAN is unconditional
 * — `textHasCandidate` always looks at the unescaped view. A gate here would
 * recreate the disagreement this function exists to close.
 *
 * When the pass is percent-aware it also matches the percent-decoded spelling of
 * the unescaped view, mapping back through both index maps at once. That covers
 * the scan's fourth and last view (`viewAndEncodingHaveCandidate` applied to the
 * unescaped text), so scan and rewrite look at exactly the same four spellings:
 * raw, percent-decoded, unescaped, unescaped-then-percent-decoded.
 *
 * The one ordering NEITHER covers is percent-decode BEFORE unescape (`%5Cn`
 * decoding to a backslash that then reads as an escape). They agree about
 * missing it, so it is a named gap rather than a disagreement — see KNOWN GAPS
 * in `egressGuard.ts`.
 */
function redactJsonEscaped(raw: string, ctx: RedactionContext): string {
  const view = jsonUnescapeWithMap(raw);
  if (view === null) return raw;
  const toRaw: IndexMap = (i) => rawIndexIn(view, i);
  const ranges = toRawRanges(matchRanges(view.decoded, ctx), toRaw);
  if (ctx.percentAware && view.decoded.includes('%')) {
    const { decoded, map } = decodeWithMap(view.decoded);
    if (decoded !== view.decoded) {
      ranges.push(...toRawRanges(matchRanges(decoded, ctx), composeMaps(toRaw, arrayMap(map))));
    }
  }
  return spliceRanges(raw, ranges);
}

/**
 * The four spellings, in the order the scan checks them. Each pass runs on the
 * previous one's output, so a secret already removed cannot be matched twice and
 * a splice cannot invalidate a later pass's offsets.
 */
function redactString(input: string, ctx: RedactionContext): string {
  const literal = redactLiteral(input, ctx);
  const percent = ctx.percentAware ? redactPercentEncoded(literal, ctx) : literal;
  return redactJsonEscaped(percent, ctx);
}

/** One view scanned: an `includes` per environment value plus one regex test. */
function viewHasCandidate(text: string, ctx: RedactionContext): boolean {
  for (const value of ctx.envValues) {
    if (text.includes(value)) return true;
  }
  ctx.shapes.lastIndex = 0;
  const hit = ctx.shapes.test(text);
  ctx.shapes.lastIndex = 0;
  return hit;
}

/** A view and, where the context asks for it, its percent-decoded spelling. */
function viewAndEncodingHaveCandidate(text: string, ctx: RedactionContext): boolean {
  if (viewHasCandidate(text, ctx)) return true;
  if (!ctx.percentAware || !text.includes('%')) return false;
  const { decoded } = decodeWithMap(text);
  if (decoded === text) return false;
  return viewHasCandidate(decoded, ctx);
}

/**
 * Would this pass rewrite anything at all in `text`?
 *
 * This is the whole reason the guard can hand back a body's ORIGINAL bytes. It
 * is a linear scan with no `JSON.parse`, no tree walk and no re-serialisation.
 *
 * THE INVARIANT, stated as the property a caller actually depends on rather
 * than as a property of the configuration:
 *
 *     for any JSON-serialisable value V,
 *       JSON.stringify(pass.redactValue(V)) !== JSON.stringify(V)
 *         =>  pass.hasCandidate(JSON.stringify(V))
 *
 * i.e. IF THE PARSED LEAVES (or keys) WOULD BE REDACTED, THE SCAN SAYS
 * CANDIDATE. The previous wording — "both read the same environment list and
 * the same shape alternation off one context" — asserted identical
 * CONFIGURATION, which is adjacent to the property and was true while the
 * property was false (lessons-learned #1). `redactSecrets.test.ts` pins the
 * composition above over a corpus of escaped forms, not one example.
 *
 * It is achieved by scanning both the raw text and its JSON-unescaped view (see
 * `jsonUnescapeWithMap`), each with its percent-decoded spelling. It remains a
 * strict OVER-approximation: it may say "maybe" and be wrong, but it must never
 * say "no" where redaction would have said "yes", or a secret ships.
 *
 * The four views scanned here are the four `redactString` rewrites, one for one,
 * off the same two decoders — that is what makes "detected" and "rewritten" the
 * same set rather than two sets that happen to overlap. `redactSecrets.test.ts`
 * pins the pair directly (`hasCandidate(s) => redactText(s) !== s`), and
 * `egressGuard.ts` still fails closed if they ever disagree anyway.
 */
function textHasCandidate(text: string, ctx: RedactionContext): boolean {
  if (viewAndEncodingHaveCandidate(text, ctx)) return true;
  const view = jsonUnescapeWithMap(text);
  if (view === null) return false;
  return viewAndEncodingHaveCandidate(view.decoded, ctx);
}

/**
 * Per-ROOT traversal state. Not on the context, because a pass redacts several
 * independent roots (a body, an array of header values, an array of cookies) and
 * each gets its own budget and its own ancestor set.
 */
interface TraversalState {
  /** Values visited so far, against `MAX_REDACTION_NODES`. */
  nodes: number;
  /**
   * The ANCESTORS of the value currently being visited — added on the way in,
   * removed on the way out. Deliberately not "everything seen": a DAG that
   * references one object from two places is not a cycle, and flagging it would
   * destroy legitimate data exactly as the depth bound did.
   */
  path: WeakSet<object>;
}

/**
 * A value that is an object but must NOT be rebuilt key-by-key, and is not a
 * container to descend into either.
 *
 * The version before this copied own ENUMERABLE keys into a fresh plain object,
 * which silently destroyed anything holding its state elsewhere: a `Date` in
 * `details` serialised as `{}` instead of an ISO string, and an `Error` became
 * `{}` because `message`, `name` and `stack` are non-enumerable. That corrupts
 * legitimate output, which is exactly the harm this module claims to avoid.
 *
 * Returns `undefined` for anything the walk should descend into.
 */
function redactExoticLeaf(input: object, ctx: RedactionContext): unknown | undefined {
  if (input instanceof Date) return input;
  if (input instanceof RegExp) return input;
  if (input instanceof Error) {
    // Reconstructing the Error would lose its subclass, so return a plain
    // record of its redacted strings — which is what a JSON body would have
    // shown anyway. `stack` is deliberately omitted: it is server detail.
    return {
      name: redactString(input.name, ctx),
      message: redactString(input.message, ctx),
    };
  }
  if (ArrayBuffer.isView(input) || input instanceof ArrayBuffer) return input;
  return undefined;
}

/** A rebuilt container the walk writes finished children into. */
type Container = unknown[] | Record<string, unknown> | Map<unknown, unknown> | Set<unknown>;

/**
 * Assign one finished child into its parent.
 *
 * `record[key] = value` is wrong for exactly one key. `__proto__` is an accessor
 * on `Object.prototype`, so a plain assignment invokes the SETTER instead of
 * creating an own property: the key vanishes from the output, and when its value
 * is an object it is installed as this object's prototype rather than kept as
 * data. `sceneData` is `z.record(z.string(), z.unknown())` carrying engine- and
 * user-authored JSON, so the key is reachable — and losing a key silently is the
 * same class of harm as the depth bound this file used to have.
 */
function writeChild(target: Container, key: unknown, value: unknown): void {
  if (Array.isArray(target)) {
    target[key as number] = value;
    return;
  }
  if (target instanceof Set) {
    target.add(value);
    return;
  }
  if (target instanceof Map) {
    target.set(key, value);
    return;
  }
  const record = target as Record<string, unknown>;
  if (key === '__proto__') {
    Object.defineProperty(record, key, {
      value,
      writable: true,
      enumerable: true,
      configurable: true,
    });
    return;
  }
  record[key as string] = value;
}

/**
 * The children of a container, plus the empty shell to rebuild it into.
 * `keys` is `null` where position is the key (arrays) or where there is no key
 * at all (sets).
 */
interface OpenedContainer {
  values: unknown[];
  keys: unknown[] | null;
  target: Container;
}

/**
 * Two keys that redact to the same placeholder would collide, and
 * `record[key] = value` / `map.set(key, value)` resolves a collision by SILENTLY
 * DROPPING the earlier entry. Losing a key without a trace is the depth bound's
 * mistake in miniature, so a repeat is suffixed instead: `[REDACTED]`,
 * `[REDACTED] (2)`, `[REDACTED] (3)`, assigned in source key order so the same
 * input always produces the same output.
 *
 * Only called when redaction actually changed a key, because `Object.keys` and
 * `Map` keys are distinct by construction and cannot collide otherwise.
 */
function disambiguateKeys(keys: unknown[]): unknown[] {
  const seen = new Set<unknown>();
  return keys.map((key) => {
    if (!seen.has(key)) {
      seen.add(key);
      return key;
    }
    if (typeof key !== 'string') return key;
    let n = 2;
    while (seen.has(`${key} (${n})`)) n += 1;
    const renamed = `${key} (${n})`;
    seen.add(renamed);
    return renamed;
  });
}

/**
 * Redact the KEYS of a container.
 *
 * This used to be skipped entirely: `Object.keys(source)` went straight into
 * `writeChild` and only values reached `redactString`. A body whose only
 * occurrence of a credential was in key position — `{"msy_…":"invalid"}`, the
 * literal shape of a provider echoing the key it rejected — made
 * `hasCandidate` return true (the text IS there), took the slow path, paid the
 * whole parse/walk/re-serialise round trip, and emitted the key unchanged. That
 * is the worst available outcome: the body pays the lossy path AND still leaks,
 * and it falsified the module's own claim that HOWEVER a response was assembled
 * it is redacted here.
 *
 * Non-string keys (a `Map` keyed by an object or a number) are passed through,
 * and the REASON is that a key is not walked — not that a key holds no text. An
 * earlier version of this comment said "they carry no text", which is simply
 * false and demonstrably so: `redactSecrets({ m: new Map([[{ token: 'msy_…' },
 * 'v']]) })` returns that key with the credential intact. Walking INTO a key
 * would change what the key IS, which is a different operation from redacting
 * one, and rebuilding an object key would break identity for every `Map` that
 * depends on it. So the pass-through stays and the gap is NAMED — a false
 * premise for a security gap is what lessons-learned #11 is about, and a reader
 * who believed the old sentence would not go looking for the case.
 *
 * KNOWN GAP, and unreachable on today's paths: `JSON.parse` produces no `Map`
 * and no non-string key, so no response body can carry one, and `sentryConfig`
 * hands this module strings. It is listed so a future caller that walks a
 * hand-built structure knows the edge exists.
 */
function redactKeys(keys: unknown[], ctx: RedactionContext): unknown[] {
  let changed = false;
  const out = keys.map((key) => {
    if (typeof key !== 'string') return key;
    const clean = redactString(key, ctx);
    if (clean !== key) changed = true;
    return clean;
  });
  return changed ? disambiguateKeys(out) : out;
}

function openContainer(input: object, ctx: RedactionContext): OpenedContainer {
  if (Array.isArray(input)) {
    return { values: input, keys: null, target: new Array<unknown>(input.length) };
  }
  if (input instanceof Map) {
    const entries = [...input.entries()];
    return {
      values: entries.map((e) => e[1]),
      keys: redactKeys(entries.map((e) => e[0]), ctx),
      target: new Map(),
    };
  }
  if (input instanceof Set) {
    return { values: [...input], keys: null, target: new Set() };
  }
  const source = input as Record<string, unknown>;
  const keys = Object.keys(source);
  return { values: keys.map((k) => source[k]), keys: redactKeys(keys, ctx), target: {} };
}

/** One container being rebuilt, and the slot its finished form belongs in. */
interface Frame extends OpenedContainer {
  obj: object;
  i: number;
  outTarget: Container;
  outKey: unknown;
}

/**
 * The traversal. ITERATIVE, over an explicit stack, deliberately.
 *
 * A recursive walk is bounded by the JS call stack — roughly ten thousand
 * frames — so a deeply nested body would throw `RangeError` instead of being
 * redacted, and the claim "depth never destroys data" would be false at a limit
 * nobody chose and no test names. An explicit stack has no such limit: the only
 * bounds are a genuine cycle (replaced with `CIRCULAR_PLACEHOLDER`, the only
 * serialisable answer) and `MAX_REDACTION_NODES` (which THROWS, so the caller
 * fails closed rather than emitting something truncated).
 */
function redactWith<T>(input: T, ctx: RedactionContext, state: TraversalState): T {
  const root: unknown[] = [undefined];
  const stack: Frame[] = [];

  const emit = (value: unknown, outTarget: Container, outKey: unknown): void => {
    state.nodes += 1;
    if (state.nodes > MAX_REDACTION_NODES) {
      throw new RedactionBudgetExceededError(MAX_REDACTION_NODES);
    }
    if (value === null || value === undefined) {
      writeChild(outTarget, outKey, value);
      return;
    }
    if (typeof value === 'string') {
      writeChild(outTarget, outKey, redactString(value, ctx));
      return;
    }
    if (typeof value !== 'object') {
      writeChild(outTarget, outKey, value);
      return;
    }
    const obj = value as object;
    // Only an ANCESTOR counts as a cycle. "Anything seen before" would flag a
    // DAG — one tileset referenced by two entities — and destroy data that has
    // a perfectly good serialisation.
    if (state.path.has(obj)) {
      writeChild(outTarget, outKey, CIRCULAR_PLACEHOLDER);
      return;
    }
    const exotic = redactExoticLeaf(obj, ctx);
    if (exotic !== undefined) {
      writeChild(outTarget, outKey, exotic);
      return;
    }
    state.path.add(obj);
    stack.push({ ...openContainer(obj, ctx), obj, i: 0, outTarget, outKey });
  };

  emit(input, root, 0);
  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    if (frame.i >= frame.values.length) {
      stack.pop();
      state.path.delete(frame.obj);
      writeChild(frame.outTarget, frame.outKey, frame.target);
      continue;
    }
    const i = frame.i;
    frame.i += 1;
    emit(frame.values[i], frame.target, frame.keys ? frame.keys[i] : i);
  }
  return root[0] as T;
}

function newTraversalState(): TraversalState {
  return { nodes: 0, path: new WeakSet<object>() };
}

/**
 * Remove credential material from a string, or from every string inside a
 * structure — VALUES and the string KEYS of plain objects and `Map`s alike.
 * Keys used to be copied through untouched, so `{"msy_…":"invalid"}` survived
 * the whole walk; see `redactKeys`. Non-string leaves are returned unchanged;
 * `Date`, `RegExp`, `Map`, `Set` and typed arrays keep their identity rather
 * than collapsing to `{}`.
 *
 * `null` and `undefined` are returned as they are at every depth, including the
 * top. An earlier version coerced them to `''` at depth 0, which turned
 * `apiError(500, 'x', 'CODE', null)` into `details: ""` — a redactor that
 * changes a response's shape is doing something other than redacting.
 *
 * Never throws: this runs on the error path, and a redactor that throws would
 * turn a handled failure into an unhandled one.
 */
export function redactSecrets<T>(input: T): T {
  try {
    return createRedactionPass().redactValue(input);
  } catch {
    // Only reachable for a structure that defeats the traversal — an exotic
    // proxy, or a throwing getter. Emitting the input unredacted would be worse
    // than emitting nothing, so strings collapse to the placeholder and
    // everything else is dropped.
    return (typeof input === 'string' ? REDACTION_PLACEHOLDER : undefined) as T;
  }
}

export interface RedactionPassOptions {
  /**
   * Also match against a percent-DECODED view. See `RedactionContext`. Off by
   * default, so the Sentry path and the response constructors are unchanged.
   */
  percentAware?: boolean;
  /**
   * Include `SELF_ISSUED_SHAPES`. Default TRUE — the safe direction. A caller
   * that hands users their own newly-minted key in a 200 body (the guard, on a
   * success status) turns it off deliberately and says why.
   */
  includeSelfIssuedShapes?: boolean;
}

/**
 * One redaction pass over one response, or one Sentry event.
 *
 * WHY A PASS OBJECT rather than a function per value.
 *
 * `redactSecrets` derives — or at minimum fingerprints — the environment list on
 * every call, and the fingerprint check enumerates `process.env`.
 * `withEgressGuard` has to look at a body, every header value, every
 * `Set-Cookie` and the `statusText` for every single response; a call each would
 * pay that enumeration a dozen times per request. A pass pays it once.
 *
 * It also keeps the SCAN and the REWRITE in step, which has now failed twice in
 * two different directions and is worth stating as two separate properties:
 *
 *   1. `hasCandidate(t)` is TRUE wherever redaction would act. This is what lets
 *      the guard return a body's original bytes untouched. It broke when the
 *      scan read the SERIALISED body and the rewrite read the PARSED leaves — a
 *      JSON escape hid the credential from the scan, and the guard granted byte
 *      identity to a body carrying one.
 *   2. `hasCandidate(t)` TRUE implies `redactText(t) !== t`. This is what stops
 *      the opposite failure: detect, take the slow path, rewrite nothing, and
 *      emit the credential anyway. It broke because the scan learned to see JSON
 *      escapes and `redactString` did not.
 *
 * Both now come from the same two decoders — `decodeWithMap` and
 * `jsonUnescapeWithMap`, each used by both halves — so neither can be taught a
 * spelling the other does not know. `redactSecrets.test.ts` sweeps both
 * directions, and `withEgressGuard` re-scans its own output and fails closed if
 * they disagree regardless, because a property this file has broken twice should
 * not be the only thing standing between a credential and a client.
 *
 * Each value handed to `redactValue` is redacted as its OWN root with its own
 * traversal budget, so one large body does not consume the budget the headers
 * need.
 *
 * `redactValue` THROWS `RedactionBudgetExceededError` past
 * `MAX_REDACTION_NODES`, and it throws for a structure that defeats traversal (a
 * throwing getter, an exotic proxy). Both are deliberate: the caller must decide
 * between failing closed and emitting something partial, and the guard fails
 * closed. `hasCandidate` and `redactText` never throw.
 */
export interface RedactionPass {
  /**
   * True if redacting `text`, OR the value `text` is the JSON serialisation of,
   * COULD change it. A strict over-approximation: it may say yes and be wrong,
   * and must never say no where redaction would act. See `textHasCandidate` for
   * the invariant and why the serialised/parsed distinction matters.
   */
  hasCandidate(text: string): boolean;
  /** Redact one string. Never throws. */
  redactText(text: string): string;
  /**
   * Redact a value of any shape — string leaves AND the string keys of plain
   * objects and `Map`s. Throws past the node budget; see above.
   */
  redactValue<T>(input: T): T;
  /**
   * Nodes visited by the most recent `redactValue` call, or 0 if there has not
   * been one. Diagnostic only — it exists so the headroom claim on
   * `MAX_REDACTION_NODES` can be CHECKED against a real body rather than
   * asserted in prose, which is what `redactSecrets.test.ts` does with the
   * published-scene fixture.
   */
  lastNodeCount(): number;
}

export function createRedactionPass(options?: RedactionPassOptions): RedactionPass {
  let envValues: readonly string[];
  try {
    envValues = secretEnvValues();
  } catch {
    envValues = [];
  }
  const ctx: RedactionContext = {
    envValues,
    percentAware: options?.percentAware ?? false,
    shapes: shapesFor(options?.includeSelfIssuedShapes ?? true),
  };
  let lastNodes = 0;
  return {
    hasCandidate: (text) => textHasCandidate(text, ctx),
    redactText: (text) => redactString(text, ctx),
    redactValue: <T,>(input: T): T => {
      const state = newTraversalState();
      try {
        return redactWith(input, ctx, state);
      } finally {
        // Recorded even when the walk threw, so a caller diagnosing a budget
        // failure can see how far it got.
        lastNodes = state.nodes;
      }
    },
    lastNodeCount: () => lastNodes,
  };
}
