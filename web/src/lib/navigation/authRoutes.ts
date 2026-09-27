/**
 * Canonical hrefs for the Clerk auth pages (`app/sign-in`, public in `proxy.ts`).
 *
 * Hoisted as an `export const *_HREF` so the internal-link-integrity gate sees
 * it: a link built at a call site from a private constant is invisible to that
 * gate, which would stay green if the route moved.
 */

/** Clerk's sign-in page. */
export const SIGN_IN_HREF = '/sign-in';

/** Any fixed origin: only used to ask the URL parser where a path would land. */
const PROBE_ORIGIN = 'https://return-path.invalid';

/**
 * Query parameters never carried into a return path. `mcp` is the MCP relay
 * token (`lib/mcp/bridgeOptIn.ts`): copying it into `redirect_url` would put a
 * credential into a second URL, its history entry and the auth flow's requests.
 */
const NEVER_CARRIED_PARAMS = ['mcp'];

/**
 * Sign-in that returns to `returnTo` afterwards, the way `proxy.ts` does with
 * `returnBackUrl` and the play page's links do with `redirect_url`.
 *
 * Only a path that stays on this origin is carried, decided the way a browser
 * decides it: the value is resolved with the URL parser, which treats `\` as
 * `/` and drops tabs and newlines, so `/\evil.example` and `/<TAB>/evil.example`
 * are caught as well as `//evil.example`. Anything that leaves the origin falls
 * back to plain sign-in rather than becoming an open redirect.
 */
export function signInHrefReturningTo(returnTo: string | null | undefined): string {
  if (!returnTo || !returnTo.startsWith('/')) return SIGN_IN_HREF;
  let url: URL;
  try {
    url = new URL(returnTo, PROBE_ORIGIN);
  } catch {
    return SIGN_IN_HREF;
  }
  if (url.origin !== PROBE_ORIGIN) return SIGN_IN_HREF;
  for (const param of NEVER_CARRIED_PARAMS) url.searchParams.delete(param);
  // The parsed form, not the raw input: what is carried is exactly the path
  // the check above approved.
  return `${SIGN_IN_HREF}?redirect_url=${encodeURIComponent(`${url.pathname}${url.search}${url.hash}`)}`;
}
