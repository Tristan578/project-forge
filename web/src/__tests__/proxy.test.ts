// @vitest-environment node
/**
 * Behavioural tests for proxy.ts.
 *
 * Previously this suite read proxy.ts as a *string* and asserted
 * `source.toContain('/api/cron')`. That is a fake test: it passes off the
 * explanatory comment that merely mentions `/api/cron`, and it cannot tell a
 * working pattern (`/api/cron(.*)`) from a broken one (`/api/cron`, which would
 * NOT match the `/api/cron/health-monitor` subpath under Clerk's matcher). So
 * the "fix" for #8605 could regress to 401-ing the cron job and the green test
 * would never notice.
 *
 * These tests exercise real behaviour instead:
 *  - the public-route list run through the REAL Clerk `createRouteMatcher`;
 *  - the proxy's real auth decision (`applyAuthDecision`): public passes,
 *    protected API → 401, protected page → redirect, authed landing → dashboard.
 *    It is driven directly with a fake `auth()` result and the real matcher —
 *    proxy.ts pulls clerkMiddleware in via a runtime `require()` that the test
 *    runner can't intercept, so the decision logic is exported and tested as a
 *    pure function instead of through the live `proxy`;
 *  - a cross-route guard that imports every cron route and proves it 401s an
 *    unauthenticated request — making `/api/cron(.*)` safe to expose at the
 *    proxy is only valid because each cron route self-enforces CRON_SECRET.
 */
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { createRouteMatcher } from '@clerk/nextjs/server';

import { buildPublicRoutes, applyAuthDecision } from '../proxy';

vi.mock('server-only', () => ({}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function reqFor(pathname: string, init?: { method?: string; origin?: string }): any {
  const url = `https://spawnforge.ai${pathname}`;
  return {
    nextUrl: new URL(url),
    url,
    method: init?.method ?? 'GET',
    headers: new Headers(init?.origin ? { origin: init.origin } : {}),
  };
}

describe('proxy public-route matcher (real Clerk matcher)', () => {
  const isPublic = (() => {
    const matcher = createRouteMatcher(buildPublicRoutes({ includeDev: false }));
    return (pathname: string) => matcher(reqFor(pathname));
  })();

  it('treats Vercel cron subpaths as public so CRON_SECRET auth can run (#8605)', () => {
    // The whole point of #8605: the *subpath* the scheduler actually calls must
    // match. A bare `/api/cron` pattern (no `(.*)`) fails this assertion even
    // though the old substring check passed — which is the bug class we are
    // closing.
    expect(isPublic('/api/cron/health-monitor')).toBe(true);
    expect(isPublic('/api/cron')).toBe(true);
  });

  it('keeps authenticated endpoints protected (not public)', () => {
    expect(isPublic('/api/generate/gdd')).toBe(false);
    expect(isPublic('/api/generate')).toBe(false);
    expect(isPublic('/api/projects')).toBe(false);
    expect(isPublic('/dashboard')).toBe(false);
  });

  it('keeps the other unauthenticated routes public', () => {
    expect(isPublic('/api/health')).toBe(true);
    expect(isPublic('/api/status/live')).toBe(true);
    expect(isPublic('/api/auth/webhook')).toBe(true);
    expect(isPublic('/api/stripe/webhook')).toBe(true);
    expect(isPublic('/api/community/feed')).toBe(true);
    expect(isPublic('/sign-in')).toBe(true);
    expect(isPublic('/sign-up/sso-callback')).toBe(true);
  });

  it('only exposes the /dev auth-bypass route when includeDev (non-production) (#7915)', () => {
    const prod = createRouteMatcher(buildPublicRoutes({ includeDev: false }));
    const dev = createRouteMatcher(buildPublicRoutes({ includeDev: true }));
    expect(prod(reqFor('/dev'))).toBe(false);
    expect(dev(reqFor('/dev'))).toBe(true);
  });
});

describe('proxy auth decision (applyAuthDecision, real matcher)', () => {
  // The real matcher the production proxy uses (production gating: /dev protected).
  const isPublicRoute = createRouteMatcher(buildPublicRoutes({ includeDev: false }));

  const redirectToSignIn = vi.fn(
    (opts: { returnBackUrl: string }) =>
      new Response(null, { status: 307, headers: { 'x-return-url': opts.returnBackUrl } }),
  );
  // Unauthenticated session — the path #8605/#8529 care about.
  const unauthed = async () => ({ userId: null, redirectToSignIn });
  // Authenticated session — exercises the landing-page redirect branch.
  const authed = async () => ({ userId: 'user_123', redirectToSignIn });

  it('lets an unauthenticated request through to a public cron route (#8605)', async () => {
    const res = await applyAuthDecision(unauthed, reqFor('/api/cron/health-monitor'), isPublicRoute);
    expect(res.status).toBe(200);
    // Never asked Clerk to redirect — the route was treated as public.
    expect(redirectToSignIn).not.toHaveBeenCalled();
  });

  it('returns 401 (not a redirect) for an unauthenticated protected API request (#8529)', async () => {
    const res = await applyAuthDecision(unauthed, reqFor('/api/generate/gdd'), isPublicRoute);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Unauthorized');
  });

  it('redirects an unauthenticated protected page nav to sign-in, never /404 (#8529)', async () => {
    redirectToSignIn.mockClear();
    const res = await applyAuthDecision(unauthed, reqFor('/dashboard'), isPublicRoute);
    expect(res.status).toBe(307);
    // Must preserve the original URL so the user lands back where they started.
    expect(redirectToSignIn).toHaveBeenCalledWith({ returnBackUrl: 'https://spawnforge.ai/dashboard' });
  });

  it('redirects an authenticated user away from the landing page to the dashboard', async () => {
    const res = await applyAuthDecision(authed, reqFor('/'), isPublicRoute);
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('https://spawnforge.ai/dashboard');
  });
});

describe('cron routes self-enforce auth (guard for the public-at-proxy decision)', () => {
  // Exposing `/api/cron(.*)` at the proxy (#8605) is only safe because every
  // cron route rejects an unauthenticated request itself. This guard imports
  // EVERY cron route and proves it 401s without a CRON_SECRET — so a future
  // cron route added without auth fails CI rather than silently shipping an
  // open, Clerk-bypassed endpoint.
  const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
  const cronDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../app/api/cron');

  // Recursively collect every `route.ts` under app/api/cron, skipping test dirs.
  function findCronRoutes(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (entry.name === '__tests__') continue;
        out.push(...findCronRoutes(path.join(dir, entry.name)));
      } else if (entry.name === 'route.ts' || entry.name === 'route.tsx') {
        out.push(path.join(dir, entry.name));
      }
    }
    return out;
  }
  const cronRoutes = findCronRoutes(cronDir);

  beforeAll(() => {
    vi.stubEnv('CRON_SECRET', ''); // unconfigured → every cron route must reject
  });
  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it('discovers at least one cron route to guard', () => {
    expect(cronRoutes.length).toBeGreaterThan(0);
  });

  for (const routePath of cronRoutes) {
    const rel = path.relative(cronDir, routePath);
    it(`${rel} returns 401 for an unauthenticated request`, async () => {
      const mod = (await import(routePath)) as Record<string, unknown>;
      const handlers = HTTP_METHODS.filter((m) => typeof mod[m] === 'function');
      expect(handlers.length).toBeGreaterThan(0);
      for (const method of handlers) {
        const handler = mod[method] as (req: NextRequest) => Promise<Response>;
        const res = await handler(
          new NextRequest('https://spawnforge.ai/api/cron/x', { method }),
        );
        expect(res.status).toBe(401);
      }
    });
  }
});
