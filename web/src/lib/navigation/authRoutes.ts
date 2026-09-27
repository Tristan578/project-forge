/**
 * Canonical hrefs for the Clerk auth pages (`app/sign-in`, public in `proxy.ts`).
 *
 * Hoisted as an `export const *_HREF` so the internal-link-integrity gate sees
 * it: a link built at a call site from a private constant is invisible to that
 * gate, which would stay green if the route moved.
 */

/** Clerk's sign-in page. */
export const SIGN_IN_HREF = '/sign-in';

/**
 * Sign-in that returns to `returnTo` afterwards, the way `proxy.ts` does with
 * `returnBackUrl` and the play page's links do with `redirect_url`. Only a
 * same-origin path is carried: anything else (an absolute or protocol-relative
 * URL) falls back to plain sign-in rather than becoming an open redirect.
 */
export function signInHrefReturningTo(returnTo: string | null | undefined): string {
  if (!returnTo || !returnTo.startsWith('/') || returnTo.startsWith('//')) return SIGN_IN_HREF;
  return `${SIGN_IN_HREF}?redirect_url=${encodeURIComponent(returnTo)}`;
}
