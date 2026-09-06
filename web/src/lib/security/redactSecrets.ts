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
 * WHERE THIS ACTUALLY RUNS, stated precisely because the first version of this
 * comment overstated it. Redaction is on the catch path because
 * `spawnforge/no-raw-response-in-catch` (see `web/eslint-rules/`) forbids
 * building a response inside a catch with anything except the constructors in
 * `lib/api/errors.ts`, all of which call this module. Before that rule existed
 * the claim was false: 89 of 101 route files built error bodies with a raw
 * `NextResponse.json`, so this "net" sat under about 1% of the API surface —
 * including none of the routes that had the defect. The lint rule is what makes
 * the sentence true; without it this file is decoration.
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
 * Redaction is a net, not a licence. Callers must still keep upstream text out
 * of user-facing strings — the lint rule above is what enforces that, and this
 * module is what catches what a static rule cannot see.
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
 *    set). Both checks are direct reads: no allocation, no regex, no sort.
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

function redactString(input: string, envValues: readonly string[]): string {
  let out = input;
  for (const value of envValues) {
    // `split`/`join`, not a RegExp: the value is arbitrary and may contain
    // regex metacharacters. Compiling it as a pattern would both fail to match
    // the real secret and redact unrelated text that happened to match.
    out = out.split(value).join(REDACTION_PLACEHOLDER);
  }
  for (const shape of SECRET_SHAPES) {
    shape.lastIndex = 0;
    out = out.replace(shape, REDACTION_PLACEHOLDER);
  }
  return out;
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
  envValues: readonly string[],
  depth: number,
): unknown | undefined {
  if (input instanceof Date) return input;
  if (input instanceof RegExp) return input;
  if (input instanceof Error) {
    // Reconstructing the Error would lose its subclass, so return a plain
    // record of its redacted strings — which is what a JSON body would have
    // shown anyway. `stack` is deliberately omitted: it is server detail.
    return {
      name: redactString(input.name, envValues),
      message: redactString(input.message, envValues),
    };
  }
  if (input instanceof Map) {
    return new Map(
      [...input.entries()].map(([k, v]) => [k, redactWith(v, envValues, depth + 1)]),
    );
  }
  if (input instanceof Set) {
    return new Set([...input].map((v) => redactWith(v, envValues, depth + 1)));
  }
  if (ArrayBuffer.isView(input) || input instanceof ArrayBuffer) return input;
  return undefined;
}

function redactWith<T>(input: T, envValues: readonly string[], depth: number): T {
  if (input === null || input === undefined) return input;
  if (typeof input === 'string') return redactString(input, envValues) as T;
  if (typeof input !== 'object') return input;

  // The depth bound REPLACES the sub-tree rather than passing it through.
  if (depth >= MAX_DEPTH) return DEPTH_LIMIT_PLACEHOLDER as T;

  if (Array.isArray(input)) {
    return input.map((item) => redactWith(item, envValues, depth + 1)) as T;
  }

  const exotic = redactExotic(input, envValues, depth);
  if (exotic !== undefined) return exotic as T;

  const source = input as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(source)) {
    result[key] = redactWith(source[key], envValues, depth + 1);
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
    return redactWith(input, secretEnvValues(), 0);
  } catch {
    // Only reachable for a structure that defeats the traversal — an exotic
    // proxy, or a throwing getter. Emitting the input unredacted would be worse
    // than emitting nothing, so strings collapse to the placeholder and
    // everything else is dropped.
    return (typeof input === 'string' ? REDACTION_PLACEHOLDER : undefined) as T;
  }
}
