/**
 * E2E test-hook gating.
 *
 * The editor exposes its Zustand stores and a command dispatcher on `window`
 * (`__EDITOR_STORE`, `__CHAT_STORE`, `__FORGE_DISPATCH`) so Playwright specs can
 * drive and read editor state deterministically. That surface is a test/debug
 * affordance, never meant for end users, so it is OFF by default.
 *
 * It turns on in exactly two situations:
 *   1. Any non-production build (`next dev`) — local development and the
 *      default dev-mode Playwright config.
 *   2. A production build (`next build` + `next start`) ONLY when
 *      `NEXT_PUBLIC_E2E_HOOKS=true` is set AT BUILD TIME. The strict
 *      interactive-journey CI gate builds with this flag so it can assert on
 *      real store state against the same production server users hit.
 *
 * SECURITY: `NEXT_PUBLIC_E2E_HOOKS` is a build-time variable that Next.js inlines
 * into the client bundle. A normal production deploy (cd.yml) never sets it, so
 * the gate evaluates to `false` at runtime and the hooks are never attached to
 * `window`. The flag cannot be flipped by a request, header, cookie, or any
 * runtime input — turning it on requires rebuilding with the env var, which only
 * the CI journey gate does. Defaults to off; any value other than the exact
 * string "true" leaves it off (matches the `NEXT_PUBLIC_USE_DEEP_GENERATION`
 * convention).
 */
export function e2eHooksEnabled(): boolean {
  return (
    process.env.NODE_ENV !== 'production' ||
    process.env.NEXT_PUBLIC_E2E_HOOKS === 'true'
  );
}
