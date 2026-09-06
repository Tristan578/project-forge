/**
 * Last-line redaction for strings that are about to leave this process.
 *
 * WHY THIS EXISTS (#9736). The provider clients under `lib/generate/` fold the
 * upstream **response body** verbatim into the thrown error:
 *
 *     const error = await response.text().catch(() => 'Unknown error');
 *     throw new Error(`Meshy status error (${response.status}): ${error}`);
 *
 * and fourteen routes returned that error's `message` to the caller. On the
 * platform path the credential in play is the PLATFORM's, not the user's, so a
 * provider that echoes key material in an auth-failure body hands a platform
 * secret to any signed-in user. Relying on a third party's redaction policy is
 * the wrong dependency: it can change without notice and we would not know.
 *
 * The routes were fixed to send a generic message, but a fix that is only a
 * sweep is reintroduced by the next route someone writes. This module is the
 * chokepoint that holds regardless — it runs inside `createErrorResponse` and
 * inside the Sentry scrubbers, because provider text reaches a third party too.
 *
 * TWO MECHANISMS, deliberately. Either alone leaves a hole:
 *
 *  - SHAPE matching catches a credential whose value this process never holds
 *    — a user's own BYOK key quoted back inside a provider's error text — but
 *    only for shapes someone thought to list.
 *  - VALUE matching catches anything in this process's environment whatever
 *    its shape, including a provider we add tomorrow whose key format nobody
 *    here has seen. This is the half that makes the guarantee general.
 *
 * Redaction is a net, not a licence. Callers must still not put secrets in
 * user-facing strings; `web/src/app/api/__tests__/noRawErrorEgress.test.ts`
 * is what enforces that, and this module is what catches the case it cannot
 * see statically.
 */

/** What a removed value is replaced with. Stable so tests and greps can pin it. */
export const REDACTION_PLACEHOLDER = '[REDACTED]';

/**
 * Environment variables whose VALUES must never appear in outbound text.
 *
 * Name-based, because the set of secrets grows and a hardcoded list would rot.
 * `NEXT_PUBLIC_*` is excluded on purpose: Next.js inlines those into the client
 * bundle, so they are public by construction and redacting them would corrupt
 * legitimate output while protecting nothing.
 */
const SECRET_NAME_PATTERN = /(_KEY|_SECRET|_TOKEN|_PASSWORD|_DSN|DATABASE_URL|CONNECTION_STRING)$/;

/**
 * Values shorter than this are ignored. A secret-named variable set to
 * something short — a flag, a mode, an accidental placeholder — would otherwise
 * turn every occurrence of that substring in ordinary prose into a placeholder,
 * which corrupts diagnostics without protecting anything real. No credential
 * worth protecting is this short.
 */
const MIN_REDACTABLE_LENGTH = 12;

/** Bound on recursion into nested structures, so a deep or cyclic object cannot hang the request. */
const MAX_DEPTH = 8;

/**
 * Credential shapes seen in provider error bodies, or documented by the
 * provider as its key format. Ordered longest-prefix-first where prefixes
 * overlap (`sk-ant-` before `sk-`) so the more specific pattern wins.
 *
 * Each entry cites what it covers. A shape nobody has cited is a guess, and a
 * guess here is worse than nothing: it creates the impression of coverage.
 */
const SECRET_SHAPES: readonly RegExp[] = [
  // Anthropic: https://docs.anthropic.com/en/api/getting-started
  /\bsk-ant-[A-Za-z0-9_-]{16,}/g,
  // OpenAI, including the project-scoped form: https://platform.openai.com/api-keys
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/g,
  // Stripe secret and restricted keys, live and test: https://docs.stripe.com/keys
  /\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}/g,
  // Stripe webhook signing secret: https://docs.stripe.com/webhooks
  /\bwhsec_[A-Za-z0-9]{16,}/g,
  // Replicate: https://replicate.com/account/api-tokens
  /\br8_[A-Za-z0-9]{20,}/g,
  // GitHub personal access tokens: https://docs.github.com/en/authentication
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  // SpawnForge's own API keys — `forge_` + 32 hex (web/src/app/api/keys/api-key/route.ts)
  /\bforge_[0-9a-f]{32}\b/g,
  // Any bearer credential, whatever the token's shape. Catches an upstream
  // echoing back the Authorization header it was sent.
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/g,
  // Connection strings carry a password in the userinfo segment.
  /\b[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s:/@]+:[^\s@]+@[^\s]+/g,
];

/**
 * The environment values to remove, recomputed per call.
 *
 * Deliberately NOT cached: `process.env` is mutated by tests (`vi.stubEnv`) and
 * can be re-read after a config change, and a cache built at module load would
 * silently stop covering anything set afterwards — the same "protection that
 * quietly stopped applying" failure this module exists to prevent.
 */
function secretEnvValues(): string[] {
  const values: string[] = [];
  for (const [name, value] of Object.entries(process.env)) {
    if (!value || value.length < MIN_REDACTABLE_LENGTH) continue;
    if (name.startsWith('NEXT_PUBLIC_')) continue;
    if (!SECRET_NAME_PATTERN.test(name)) continue;
    values.push(value);
  }
  // Longest first: if one secret is a substring of another, removing the longer
  // one first prevents a partial redaction that leaves the tail exposed.
  return values.sort((a, b) => b.length - a.length);
}

function redactString(input: string): string {
  let out = input;
  for (const value of secretEnvValues()) {
    // `split`/`join`, not a RegExp: the value is arbitrary and may contain
    // regex metacharacters. Compiling it as a pattern would both fail to match
    // the real secret and redact unrelated text that happened to match.
    out = out.split(value).join(REDACTION_PLACEHOLDER);
  }
  for (const shape of SECRET_SHAPES) {
    out = out.replace(shape, REDACTION_PLACEHOLDER);
  }
  return out;
}

/**
 * Remove credential material from a string, or from every string inside a
 * structure. Non-string leaves are returned as they are.
 *
 * Never throws: this runs on the error path, and a redactor that throws would
 * turn a handled failure into an unhandled one.
 */
export function redactSecrets<T>(input: T, depth = 0): T {
  // At the top level the caller wanted outbound text, so a missing value
  // becomes the empty string. Inside a structure it is left alone: turning a
  // `null` field into `""` would silently change a response's shape.
  if (input === null || input === undefined) {
    return (depth === 0 ? '' : input) as T;
  }
  if (typeof input === 'string') {
    return redactString(input) as T;
  }
  if (depth >= MAX_DEPTH) return input;
  if (Array.isArray(input)) {
    return input.map((item) => redactSecrets(item, depth + 1)) as T;
  }
  if (typeof input === 'object') {
    const source = input as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(source)) {
      result[key] = redactSecrets(source[key], depth + 1);
    }
    return result as T;
  }
  return input;
}
