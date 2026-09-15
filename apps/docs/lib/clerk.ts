/**
 * Clerk configuration checks shared by the docs build and render guards.
 *
 * Local development and CI may omit both Clerk keys. In that state the app
 * skips ClerkProvider and shows the authentication-unavailable message.
 * A truthy secret with no publishable key fails the build (#9721), as does a
 * malformed publishable key (#9044). A usable publishable key retains the
 * existing behavior when no secret is configured.
 *
 * The key-shape check catches truncated values and pasted NAME=value
 * assignments before Clerk derives an invalid script host from them.
 * NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is inlined at build time; the secret-key
 * check belongs to the server-side build configuration.
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
  // TRIMMED FIRST, and that is load-bearing (#9558). Clerk tolerates surrounding
  // whitespace, so rejecting what Clerk accepts is simply wrong — and it was
  // worse than wrong here: the payload regex below has no `s` flag, so a single
  // trailing newline made it match NOTHING, the key was reported as
  // "does not decode", and the docs production deploy failed on a key the live
  // site was already running on. A guard that blocks deploys on a working value
  // is a worse failure than the silent degradation it was written to prevent.
  const key = (raw ?? '').trim();
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
  // Trimmed here too. Without it a whitespace-only value ('   ') is non-empty,
  // clerkPublishableKeyProblem trims it to '' and reports no problem, and
  // <ClerkProvider> would mount on garbage (#9558).
  const key = (process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? '').trim();
  return key !== '' && clerkPublishableKeyProblem(key) === null;
}

/**
 * True when the configured value carries surrounding whitespace but is
 * otherwise usable.
 *
 * Not a failure — Clerk accepts it and the build proceeds — but the variable is
 * untidy and one edit away from a real problem, so the build says so once.
 */
export function clerkPublishableKeyHasSurroundingWhitespace(
  raw: string | undefined = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
): boolean {
  const value = raw ?? '';
  const trimmed = value.trim();
  return trimmed !== '' && trimmed !== value && clerkPublishableKeyProblem(trimmed) === null;
}

/**
 * Fail the build when Clerk is configured in a way that cannot work.
 *
 * Called from `next.config.ts`, so the error surfaces during `next build`: the
 * deploy goes red and the bad configuration never reaches production.
 * Deliberately NOT a runtime throw — docs pages are overwhelmingly public
 * content, and taking the whole site down over a broken auth key would be a
 * worse outcome than the bug this guards against.
 *
 * Two distinct build-failing states, both covered by tests:
 *
 *  - MALFORMED publishable key. A key IS set but cannot work (paste error,
 *    secret key, undecodable payload). Diagnosed by `clerkPublishableKeyProblem`
 *    (#9044).
 *  - HALF-CONFIGURED Clerk. `CLERK_SECRET_KEY` is set but the publishable key is
 *    absent (#9721). `proxy.ts` passes requests straight through only when the
 *    secret key is UNSET, so a set secret with no publishable key runs
 *    `clerkMiddleware`, which throws "Missing publishableKey" on every request
 *    while sign-in is silently dead. This is exactly the state that shipped to
 *    docs.spawnforge.ai after #9044's malformed key was removed rather than
 *    corrected — the malformed-key guard had nothing left to catch.
 *
 * ABSENT-BOTH stays a supported state: local checkouts and CI build without any
 * Clerk credentials.
 *
 * @param raw Publishable key, defaulting to NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY.
 * @param secretKey Server secret, defaulting to CLERK_SECRET_KEY.
 * @returns Nothing when the configuration passes these build checks.
 * @throws When the publishable key is malformed or a secret has no publishable key.
 */
export function assertClerkPublishableKeyShape(
  raw: string | undefined = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  secretKey: string | undefined = process.env.CLERK_SECRET_KEY,
): void {
  const problem = clerkPublishableKeyProblem(raw);
  if (problem !== null) {
    throw new Error(
      `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is set but unusable: ${problem}. ` +
        'Authentication would be silently dead on the deployed docs site (#9044). ' +
        'Fix the value in the Vercel project settings (or in .env.local for a ' +
        'local build). To build with authentication disabled, remove both ' +
        'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY; leaving only ' +
        'the secret key configured is not supported.',
    );
  }

  // problem === null means the publishable key is USABLE or ABSENT. An absent
  // publishable key alongside a PRESENT secret key is the half-configured state
  // (#9721): distinct from the malformed case above, and just as certainly a
  // mistake. The secret value is never interpolated into the message — it is a
  // real secret, unlike the publishable key.
  const publishableAbsent = (raw ?? '').trim() === '';
  // Match proxy.ts: even whitespace makes a raw secret value truthy and enters
  // Clerk middleware. Trimming here would let that broken configuration build.
  const secretPresent = Boolean(secretKey);
  if (publishableAbsent && secretPresent) {
    throw new Error(
      'CLERK_SECRET_KEY is set but NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is absent. ' +
        'A half-configured Clerk instance leaves sign-in silently dead and makes ' +
        'the docs middleware throw "Missing publishableKey" on every request ' +
        '(#9721). Set NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY (production and preview) ' +
        'to the matching Clerk instance key, or remove CLERK_SECRET_KEY to build ' +
        'the docs with authentication disabled — configure BOTH keys or NEITHER.',
    );
  }

  // Usable but untidy: surrounding whitespace works (Clerk trims) so it must
  // not fail the build, but it is worth saying once rather than silently
  // normalising and letting the value rot (#9558).
  if (clerkPublishableKeyHasSurroundingWhitespace(raw)) {
    console.warn(
      'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY has leading or trailing whitespace. ' +
        'It works — Clerk trims — but the stored value should be the key alone.',
    );
  }
}
