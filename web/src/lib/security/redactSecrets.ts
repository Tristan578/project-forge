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

/** What a sub-tree past the depth bound is replaced with. See `MAX_DEPTH`. */
export const DEPTH_LIMIT_PLACEHOLDER = '[REDACTED: nesting depth limit]';

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
 * Values shorter than this are ignored. A secret-named variable set to
 * something short — a flag, a mode, an accidental placeholder — would otherwise
 * turn every occurrence of that substring in ordinary prose into a placeholder,
 * which corrupts diagnostics without protecting anything real. No credential
 * worth protecting is this short.
 */
const MIN_REDACTABLE_LENGTH = 12;

/**
 * Bound on recursion into nested structures, so a deep or cyclic object cannot
 * hang the request. Past the bound the sub-tree is REPLACED, not returned: the
 * previous `return input` emitted a secret nested nine levels deep verbatim,
 * and the only test on the bound asserted that a cyclic input did not throw —
 * which would have passed over a total leak.
 */
const MAX_DEPTH = 8;

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
  // SpawnForge's own API keys — `forge_` + 32 hex (web/src/app/api/keys/api-key/route.ts)
  /\bforge_[0-9a-f]{32}\b/g,
  // Any bearer credential, whatever the token's shape. Catches an upstream
  // echoing back the Authorization header it was sent, and is the ONLY shape
  // cover for suno and hyper3d BYOK keys, which have no documented prefix.
  /\bBearer\s{1,8}[A-Za-z0-9._~+/=-]{12,400}/g,
  // Connection strings carry a password in the userinfo segment.
  /\b[a-zA-Z][a-zA-Z0-9+.-]{0,20}:\/\/[^\s:/@]{1,100}:[^\s@]{1,200}@[^\s]{1,300}/g,
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
 */
const ALL_SECRET_SHAPES = new RegExp(SECRET_SHAPES.map((s) => s.source).join('|'), 'g');

function redactLiteral(input: string, envValues: readonly string[]): string {
  let out = input;
  for (const value of envValues) {
    // `split`/`join`, not a RegExp: the value is arbitrary and may contain
    // regex metacharacters. Compiling it as a pattern would both fail to match
    // the real secret and redact unrelated text that happened to match.
    //
    // `includes` first: `split` allocates an array even when there is no match,
    // and on the response path there is no match on the overwhelming majority
    // of leaves.
    if (out.includes(value)) out = out.split(value).join(REDACTION_PLACEHOLDER);
  }
  ALL_SECRET_SHAPES.lastIndex = 0;
  return out.replace(ALL_SECRET_SHAPES, REDACTION_PLACEHOLDER);
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
function matchRanges(decoded: string, envValues: readonly string[]): [number, number][] {
  const ranges: [number, number][] = [];
  for (const value of envValues) {
    let from = 0;
    for (;;) {
      const at = decoded.indexOf(value, from);
      if (at === -1) break;
      ranges.push([at, at + value.length]);
      from = at + value.length;
    }
  }
  ALL_SECRET_SHAPES.lastIndex = 0;
  for (;;) {
    const m = ALL_SECRET_SHAPES.exec(decoded);
    if (m === null) break;
    ranges.push([m.index, m.index + m[0].length]);
    if (m[0].length === 0) ALL_SECRET_SHAPES.lastIndex += 1;
  }
  ALL_SECRET_SHAPES.lastIndex = 0;
  return ranges;
}

/**
 * Remove anything that only becomes visible once percent-escapes are resolved.
 * Runs AFTER `redactLiteral`, so a secret written plainly is already gone and
 * this pass only has to catch the encoded spelling of one.
 */
function redactPercentEncoded(raw: string, envValues: readonly string[]): string {
  if (!raw.includes('%')) return raw;
  const { decoded, map } = decodeWithMap(raw);
  if (decoded === raw) return raw;
  const ranges = matchRanges(decoded, envValues);
  if (ranges.length === 0) return raw;

  // Merge overlaps, then splice from the end so earlier offsets stay valid.
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
    out = out.slice(0, map[start]) + REDACTION_PLACEHOLDER + out.slice(map[end]);
  }
  return out;
}

function redactString(input: string, ctx: RedactionContext): string {
  const literal = redactLiteral(input, ctx.envValues);
  return ctx.percentAware ? redactPercentEncoded(literal, ctx.envValues) : literal;
}

/**
 * Values that are objects but NOT plain records, which must not be rebuilt
 * key-by-key.
 *
 * The previous implementation copied own ENUMERABLE keys into a fresh plain
 * object, which silently destroyed anything holding its state elsewhere: a
 * `Date` in `details` serialised as `{}` instead of an ISO string, and an
 * `Error` became `{}` because `message`, `name` and `stack` are non-enumerable.
 * That corrupts legitimate output, which is exactly the harm this module claims
 * to avoid.
 *
 * Returns `undefined` for a plain record, meaning "not exotic, recurse
 * normally".
 */
function redactExotic(
  input: object,
  ctx: RedactionContext,
  depth: number,
): unknown | undefined {
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
  if (input instanceof Map) {
    return new Map(
      [...input.entries()].map(([k, v]) => [k, redactWith(v, ctx, depth + 1)]),
    );
  }
  if (input instanceof Set) {
    return new Set([...input].map((v) => redactWith(v, ctx, depth + 1)));
  }
  if (ArrayBuffer.isView(input) || input instanceof ArrayBuffer) return input;
  return undefined;
}

function redactWith<T>(input: T, ctx: RedactionContext, depth: number): T {
  if (input === null || input === undefined) return input;
  if (typeof input === 'string') return redactString(input, ctx) as T;
  if (typeof input !== 'object') return input;

  // The depth bound REPLACES the sub-tree rather than passing it through.
  if (depth >= MAX_DEPTH) return DEPTH_LIMIT_PLACEHOLDER as T;

  if (Array.isArray(input)) {
    return input.map((item) => redactWith(item, ctx, depth + 1)) as T;
  }

  const exotic = redactExotic(input, ctx, depth);
  if (exotic !== undefined) return exotic as T;

  const source = input as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(source)) {
    result[key] = redactWith(source[key], ctx, depth + 1);
  }
  return result as T;
}

/**
 * Remove credential material from a string, or from every string inside a
 * structure. Non-string leaves are returned unchanged; `Date`, `RegExp`, `Map`,
 * `Set` and typed arrays keep their identity rather than collapsing to `{}`.
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
    return redactWith(input, { envValues: secretEnvValues(), percentAware: false }, 0);
  } catch {
    // Only reachable for a structure that defeats the traversal — an exotic
    // proxy, or a throwing getter. Emitting the input unredacted would be worse
    // than emitting nothing, so strings collapse to the placeholder and
    // everything else is dropped.
    return (typeof input === 'string' ? REDACTION_PLACEHOLDER : undefined) as T;
  }
}

/**
 * Redact several INDEPENDENT values in one environment derivation.
 *
 * `redactSecrets` derives (or fingerprints) the environment list once per call,
 * and the fingerprint check enumerates `process.env`. `withEgressGuard` has to
 * redact a body, an array of header values and an array of `Set-Cookie` values
 * for every single response; calling `redactSecrets` three times would pay that
 * enumeration three times per request. This pays it once.
 *
 * Each input is redacted as its OWN root at depth 0. That matters: wrapping
 * them in one carrier object would consume a level of `MAX_DEPTH`, so a
 * legitimate response body nested eight deep would start being truncated by the
 * act of guarding it.
 *
 * `percentAware` looks THROUGH percent-encoding as well as at the literal text
 * (see `RedactionContext`). `withEgressGuard` sets it, because a redirect
 * `Location` and a `Set-Cookie` value are URL-encoded by the time they are
 * headers, and encoding destroys the word boundary every credential shape is
 * anchored on. It is off by default so the Sentry path and the response
 * constructors keep their existing behaviour exactly.
 *
 * Never throws, for the same reason `redactSecrets` does not — and a failure on
 * one input does not affect the others.
 */
export function redactSecretsAll(
  inputs: readonly unknown[],
  options?: { percentAware?: boolean },
): unknown[] {
  let envValues: readonly string[];
  try {
    envValues = secretEnvValues();
  } catch {
    envValues = [];
  }
  const ctx: RedactionContext = { envValues, percentAware: options?.percentAware ?? false };
  return inputs.map((input) => {
    try {
      return redactWith(input, ctx, 0);
    } catch {
      return typeof input === 'string' ? REDACTION_PLACEHOLDER : undefined;
    }
  });
}
