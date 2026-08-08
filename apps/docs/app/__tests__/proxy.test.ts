/**
 * @vitest-environment node
 *
 * Behavioural tests for the docs proxy's public-route surface, run through the
 * REAL Clerk `createRouteMatcher`. The proxy's default is to PROTECT, so a route
 * is public only by being listed — an omission is not a neutral default, it is a
 * 307 to sign-in for anyone (including a crawler) who asks for that URL.
 */
import { describe, it, expect } from 'vitest';
import { createRouteMatcher } from '@clerk/nextjs/server';
import { PUBLIC_ROUTES, config } from '../../proxy';

function reqFor(pathname: string) {
  const url = `https://docs.spawnforge.ai${pathname}`;
  return { nextUrl: new URL(url), url, method: 'GET', headers: new Headers() };
}

const matcher = createRouteMatcher(PUBLIC_ROUTES);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const isPublic = (pathname: string) => matcher(reqFor(pathname) as any);

describe('docs proxy public routes', () => {
  it('runs the proxy on /robots.txt and /sitemap.xml', () => {
    // The matcher exempts only `_next` and the favicon, so both crawler files
    // genuinely reach Clerk. That is what makes the missing public entries
    // reachable as a bug rather than a theoretical one — if this config ever
    // grows a static-file exemption, the two entries below become redundant
    // instead of load-bearing, and this assertion is where you find that out.
    expect(config.matcher).toEqual(['/((?!_next/static|_next/image|favicon.ico).*)']);
    for (const file of ['robots.txt', 'sitemap.xml']) {
      expect(config.matcher[0]).not.toContain(file);
    }
  });

  it('exposes the crawler surfaces so the sitemap is discoverable', () => {
    // Without these, `app/robots.ts` is unreadable and the sitemap it advertises
    // answers a crawler with a sign-in redirect.
    expect(isPublic('/robots.txt')).toBe(true);
    expect(isPublic('/sitemap.xml')).toBe(true);
  });

  it('keeps the anonymous entry points public', () => {
    expect(isPublic('/')).toBe(true);
    expect(isPublic('/mcp')).toBe(true);
    expect(isPublic('/mcp/commands')).toBe(true);
    expect(isPublic('/sign-in')).toBe(true);
    expect(isPublic('/sign-in/sso-callback')).toBe(true);
    expect(isPublic('/sign-up')).toBe(true);
    expect(isPublic('/api/webhooks/clerk')).toBe(true);
  });

  it('leaves everything else protected', () => {
    for (const route of ['/api-reference', '/guides/setup', '/api/internal']) {
      expect(isPublic(route), `${route} must not be public`).toBe(false);
    }
  });

  /**
   * Clerk's `createRouteMatcher` goes through `@clerk/shared`'s vendored
   * pathToRegexp, in which a bare `X(.*)` is a case-insensitive SUFFIX wildcard
   * with no path-segment boundary — `'/mcp(.*)'` would also match `/mcpadmin`.
   * These pin the two-pattern form (`'/x'` plus `'/x/(.*)'`) that closes it.
   */
  it.each(['/mcpadmin', '/sign-internal', '/sign-upgrade', '/api/webhooks-debug'])(
    'does not leak the sibling-prefix route %s through a suffix wildcard',
    (route) => {
      expect(
        isPublic(route),
        `${route} shares a prefix with a public route but is NOT that route. If this fails, a bare 'X(.*)' pattern has been reintroduced — use 'X' plus 'X/(.*)' instead.`,
      ).toBe(false);
    },
  );

  it('declares no bare suffix wildcards', () => {
    // Structural guard: every wildcard entry must be anchored at a path segment.
    const bare = PUBLIC_ROUTES.filter((r) => r.endsWith('(.*)') && !r.endsWith('/(.*)'));
    expect(bare).toEqual([]);
  });
});
