/**
 * Clerk publishable-key shape checking for the web app.
 *
 * TWO DISTINCT STATES, DELIBERATELY TREATED DIFFERENTLY (#9044):
 *
 *  - MISSING. No key configured. Legitimate — local checkouts and CI E2E builds
 *    run without Clerk credentials and degrade to "auth is not set up here".
 *    `app/layout.tsx` skips `<ClerkProvider>`; nothing throws.
 *  - MALFORMED. A key IS configured but cannot work. Always a configuration
 *    mistake, never a legitimate state, so it fails the BUILD (`next.config.ts`)
 *    instead of shipping.
 *
 * Collapsing the two is what took authentication down on docs.spawnforge.ai
 * with no signal anywhere: the Vercel env var held the whole
 * `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_...` assignment as its VALUE.
 * Clerk derives its script host by base64-decoding the key, so that decoded to
 * an EMPTY host and clerk-js was fetched from `https:///npm/...`, which cannot
 * resolve. The web app carried the identical unguarded prefix check, so the
 * same paste would have silently killed sign-in — and with it the whole paid
 * funnel — here too.
 *
 * Deliberately duplicated from `apps/docs/lib/clerk.ts` rather than shared:
 * Next.js production builds cannot import from outside `web/`.
 *
 * `NEXT_PUBLIC_*` is inlined at build time, so this reads the same value on the
 * server and in the browser bundle.
 */

import { clerkFrontendApiFromPublishableKey } from "@/lib/security/csp";

/** Prefixes Clerk accepts for a publishable key. */
const VALID_PREFIXES = ["pk_test_", "pk_live_"] as const;

/**
 * Diagnose a configured-but-unusable publishable key.
 *
 * Returns `null` when the key is usable OR absent — absence is not a defect.
 * Otherwise returns a human-readable explanation naming the specific mistake,
 * so the failure says what to fix rather than only that something is wrong.
 *
 * The value is never echoed in full: a publishable key is not a secret, but a
 * *secret* key pasted here by mistake is, and that is one of the cases this
 * diagnoses.
 */
export function clerkPublishableKeyProblem(raw: string | undefined): string | null {
  const key = raw ?? "";
  if (key === "") return null;

  if (VALID_PREFIXES.some((p) => key.startsWith(p))) {
    // A correct prefix is not enough, and the outage proves why. Clerk encodes
    // its Frontend API host in the payload as base64 of `<host>$`; a key whose
    // payload does not decode to a valid hostname yields an EMPTY host, and
    // that is literally how clerk-js came to be requested from
    // `https:///npm/...`. The same decode also feeds the /play CSP
    // (buildPlayContentSecurityPolicy), so an undecodable key silently drops
    // Clerk's host from the allowlist and its scripts are blocked there too.
    // Reusing csp.ts's implementation rather than writing a second one: two
    // copies of a security-relevant validator drift, and this one is already
    // load-bearing for a header.
    if (clerkFrontendApiFromPublishableKey(key) === null) {
      return "its prefix is right but the payload does not decode to a Clerk Frontend API host (Clerk base64-encodes \"<host>$\" there). A key in this shape resolves to an EMPTY host, which is what made clerk-js load from https:///npm/... — check for a truncated copy/paste, and note that placeholders such as pk_test_xxx are rejected here on purpose";
    }
    return null;
  }

  if (key.startsWith("sk_")) {
    return "it is a SECRET key (sk_...). Publishable keys start with pk_test_ or pk_live_, and a secret key must never reach a NEXT_PUBLIC_ variable";
  }

  // The #9044 paste error: a whole `NAME=value` assignment pasted into the
  // value field.
  const assignment = /^([A-Za-z_][A-Za-z0-9_]*)=([\s\S]*)$/.exec(key);
  if (assignment) {
    const [, name, value] = assignment;
    const tail = VALID_PREFIXES.some((p) => value.startsWith(p))
      ? `Drop the leading "${name}=" and keep only the key itself`
      : `Expected just the key, starting with ${VALID_PREFIXES.join(" or ")}`;
    return `the whole "${name}=..." assignment was pasted in as the VALUE. ${tail}`;
  }

  const trimmed = key.trim();
  if (trimmed !== key && VALID_PREFIXES.some((p) => trimmed.startsWith(p))) {
    return "it has leading or trailing whitespace. Clerk compares the key byte-for-byte, so the surrounding whitespace makes it unusable";
  }

  return `it starts with "${key.slice(0, 8)}...", which is not ${VALID_PREFIXES.join(" or ")}`;
}

/**
 * Whether a usable Clerk publishable key is configured for this build.
 *
 * False for BOTH missing and malformed keys. A malformed key should never reach
 * runtime — `next.config.ts` fails the build first — but if one somehow does,
 * degrading is still better than crashing every route.
 */
export function hasValidClerkKey(
  raw: string | undefined = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
): boolean {
  const key = raw ?? "";
  return key !== "" && clerkPublishableKeyProblem(key) === null;
}

/**
 * Fail the build when a publishable key is configured but unusable.
 *
 * Called from `next.config.ts`, so the error surfaces during `next build`: the
 * deploy goes red and the bad value never reaches production. Deliberately NOT
 * a runtime throw — a hard crash on every route would be a worse outcome than
 * the degraded-auth bug this guards against.
 */
export function assertClerkPublishableKeyShape(
  raw: string | undefined = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
): void {
  const problem = clerkPublishableKeyProblem(raw);
  if (problem === null) return;
  throw new Error(
    `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is set but unusable: ${problem}. ` +
      "Authentication would be silently dead on the deployed app (#9044). " +
      "Fix the value in the Vercel project settings (or in .env.local for a " +
      "local build), or remove it entirely to build with authentication " +
      "disabled — an ABSENT key is a supported state, an unusable one is not.",
  );
}
