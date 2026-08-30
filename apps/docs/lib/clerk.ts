/**
 * Clerk publishable-key gating for the docs app.
 *
 * TWO DISTINCT STATES, DELIBERATELY TREATED DIFFERENTLY (#9044):
 *
 *  - MISSING. No key configured at all. Legitimate — local checkouts and CI run
 *    without Clerk credentials, and the app degrades to "auth is not set up
 *    here". Soft-skips the provider; never throws.
 *  - MALFORMED. A key IS configured but cannot possibly work. That is always a
 *    configuration mistake, never a legitimate state, so it fails the BUILD
 *    (see `next.config.ts`) rather than shipping.
 *
 * The distinction exists because collapsing the two — treating anything
 * non-conforming as "Clerk is not set up here" — is how docs.spawnforge.ai
 * shipped with authentication completely dead and no signal anywhere. The
 * Vercel env var held the literal string
 * `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_...`: the whole `NAME=value`
 * assignment pasted in as the value. Clerk derives its script host by
 * base64-decoding the key, so that value decoded to an EMPTY host and clerk-js
 * was requested from `https:///npm/...`, which cannot resolve. Every sign-in on
 * the docs site was broken, silently, for as long as that value was set.
 *
 * The guard is also load-bearing for local development: @clerk/nextjs 7.8.0
 * added a `throwMissingPublishableKeyError()` to the keyless branch that used
 * to render fine without keys (#9378 / #9384).
 *
 * `NEXT_PUBLIC_*` is inlined at build time, so these read the same value on the
 * server and in the browser bundle.
 */

/** Prefixes Clerk accepts for a publishable key. */
const VALID_PREFIXES = ['pk_test_', 'pk_live_'] as const;

/**
 * Decode the Frontend API host a publishable key encodes, or `null` if it does
 * not encode one.
 *
 * `pk_(test|live)_<b64>` where the payload decodes to `<host>$`. This is the
 * check that actually catches the outage: a key whose payload does not decode
 * to a hostname yields an EMPTY host, which is exactly how clerk-js came to be
 * requested from `https:///npm/...`.
 *
 * The hostname regex is a guard, not a formatting nicety — `web/` interpolates
 * this same decoded value into a CSP header, where a payload decoding to
 * `evil.com; script-src *` would inject a directive.
 *
 * Mirrors `clerkFrontendApiFromPublishableKey` in
 * `web/src/lib/security/csp.ts`. Duplicated rather than imported because
 * Next.js production builds cannot import across the `web/` boundary; keep the
 * two in step.
 */
function clerkFrontendApiHost(publishableKey: string): string | null {
  const payload = /^pk_(?:test|live)_(.+)$/.exec(publishableKey)?.[1];
  if (!payload) return null;
  let decoded: string;
  try {
    decoded = atob(payload);
  } catch {
    return null;
  }
  if (!decoded.endsWith('$')) return null;
  const host = decoded.slice(0, -1);
  return /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(host) ? host : null;
}

/**
 * Diagnose a configured-but-unusable publishable key.
 *
 * Returns `null` when the key is usable OR absent — absence is not a defect,
 * see the module comment. Otherwise returns a human-readable explanation naming
 * the specific mistake, so the failure says what to fix rather than only that
 * something is wrong.
 *
 * The value is never echoed in full: a publishable key is not a secret, but a
 * *secret* key pasted here by mistake is, and that is one of the cases this
 * diagnoses.
 */
export function clerkPublishableKeyProblem(raw: string | undefined): string | null {
  const key = raw ?? '';
  if (key === '') return null;

  if (VALID_PREFIXES.some((p) => key.startsWith(p))) {
    // A correct prefix is not enough, and this site is the proof. Clerk encodes
    // its Frontend API host in the payload; a key whose payload does not decode
    // to a valid hostname yields an EMPTY host, which is what made clerk-js
    // load from `https:///npm/...` here.
    if (clerkFrontendApiHost(key) === null) {
      return 'its prefix is right but the payload does not decode to a Clerk Frontend API host (Clerk base64-encodes "<host>$" there). A key in this shape resolves to an EMPTY host, which is what made clerk-js load from https:///npm/... — check for a truncated copy/paste, and note that placeholders such as pk_test_xxx are rejected here on purpose';
    }
    return null;
  }

  if (key.startsWith('sk_')) {
    return 'it is a SECRET key (sk_...). Publishable keys start with pk_test_ or pk_live_, and a secret key must never reach a NEXT_PUBLIC_ variable';
  }

  // The #9044 paste error: a whole `NAME=value` assignment pasted into the
  // value field.
  const assignment = /^([A-Za-z_][A-Za-z0-9_]*)=([\s\S]*)$/.exec(key);
  if (assignment) {
    const [, name, value] = assignment;
    const tail = VALID_PREFIXES.some((p) => value.startsWith(p))
      ? `Drop the leading "${name}=" and keep only the key itself`
      : `Expected just the key, starting with ${VALID_PREFIXES.join(' or ')}`;
    return `the whole "${name}=..." assignment was pasted in as the VALUE. ${tail}`;
  }

  const trimmed = key.trim();
  if (trimmed !== key && VALID_PREFIXES.some((p) => trimmed.startsWith(p))) {
    return 'it has leading or trailing whitespace. Clerk compares the key byte-for-byte, so the surrounding whitespace makes it unusable';
  }

  return `it starts with "${key.slice(0, 8)}...", which is not ${VALID_PREFIXES.join(' or ')}`;
}

/**
 * Whether a usable Clerk publishable key is configured for this build.
 *
 * Every Clerk entry point in this app gates on this: `app/layout.tsx` skips
 * `<ClerkProvider>` entirely, and `app/sign-in/[[...sign-in]]/page.tsx` skips
 * `<SignIn />` — which needs that provider's context and would throw without
 * it.
 *
 * False for BOTH missing and malformed keys. A malformed key should never reach
 * runtime — `next.config.ts` fails the build first — but if one somehow does,
 * degrading is still better than crashing every route.
 */
export function hasValidClerkKey(): boolean {
  const key = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? '';
  return key !== '' && clerkPublishableKeyProblem(key) === null;
}

/**
 * Fail the build when a publishable key is configured but unusable.
 *
 * Called from `next.config.ts`, so the error surfaces during `next build`: the
 * deploy goes red and the bad value never reaches production. Deliberately NOT
 * a runtime throw — docs pages are overwhelmingly public content, and taking
 * the whole site down over a broken auth key would be a worse outcome than the
 * bug this guards against.
 */
export function assertClerkPublishableKeyShape(
  raw: string | undefined = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
): void {
  const problem = clerkPublishableKeyProblem(raw);
  if (problem === null) return;
  throw new Error(
    `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is set but unusable: ${problem}. ` +
      'Authentication would be silently dead on the deployed docs site (#9044). ' +
      'Fix the value in the Vercel project settings (or in .env.local for a ' +
      'local build), or remove it entirely to build the docs with ' +
      'authentication disabled — an ABSENT key is a supported state, an ' +
      'unusable one is not.',
  );
}
