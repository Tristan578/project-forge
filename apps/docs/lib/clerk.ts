/**
 * Whether a usable Clerk publishable key is configured for this build.
 *
 * Clerk validates the key format at runtime, so a missing or malformed key is
 * indistinguishable from "Clerk is not set up here". Every Clerk entry point in
 * this app gates on this: `app/layout.tsx` skips `<ClerkProvider>` entirely, and
 * `app/sign-in/[[...sign-in]]/page.tsx` skips `<SignIn />` — which needs that
 * provider's context and would throw without it.
 *
 * The guard became load-bearing in @clerk/nextjs 7.8.0, which added a
 * `throwMissingPublishableKeyError()` to the keyless branch that used to render
 * fine in local development. See #9378 / #9384.
 *
 * `NEXT_PUBLIC_*` is inlined at build time, so this reads the same value on the
 * server and in the browser bundle.
 */
export function hasValidClerkKey(): boolean {
  const key = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? '';
  return key.startsWith('pk_test_') || key.startsWith('pk_live_');
}
