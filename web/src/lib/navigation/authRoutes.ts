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
 *
 * The check runs on what is EMITTED, not only on the input. `/..//evil.example`
 * parses on this origin (a path is not a host) yet its pathname collapses to
 * `//evil.example`, and Clerk resolves that protocol-relative `redirect_url`
 * to `https://evil.example`. Re-parsing the emitted value catches every input
 * that normalises to a different origin, whatever the route there.
 */
export function signInHrefReturningTo(returnTo: string | null | undefined): string {
  if (!returnTo || !returnTo.startsWith('/')) return SIGN_IN_HREF;
  const url = parseOnProbeOrigin(returnTo);
  if (!url) return SIGN_IN_HREF;
  for (const param of NEVER_CARRIED_PARAMS) url.searchParams.delete(param);
  // The parsed form, not the raw input: what is carried is exactly the path
  // the check above approved, and it is approved a second time as emitted.
  const carried = `${url.pathname}${url.search}${url.hash}`;
  if (!parseOnProbeOrigin(carried)) return SIGN_IN_HREF;
  return `${SIGN_IN_HREF}?redirect_url=${encodeURIComponent(carried)}`;
}

/** The parsed `value` when a browser would keep it on this origin, else null. */
function parseOnProbeOrigin(value: string): URL | null {
  let url: URL;
  try {
    url = new URL(value, PROBE_ORIGIN);
  } catch {
    return null;
  }
  return url.origin === PROBE_ORIGIN ? url : null;
}

/**
 * Sign-in that returns to a published game's play page (`app/play/[userId]/[slug]`).
 * Both segments are user-supplied and encoded here; the guard above is what
 * keeps a crafted slug from turning the return path into another origin.
 */
export function signInHrefReturningToPlay(userId: string, slug: string): string {
  return signInHrefReturningTo(`/play/${encodeURIComponent(userId)}/${encodeURIComponent(slug)}`);
}
