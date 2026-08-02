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

import {
  buildPublicRoutes,
  applyAuthDecision,
  isPlayPath,
  passthroughMiddleware,
} from '../proxy';

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

  it('treats the waitlist endpoint as public so unauthenticated visitors can sign up (#8730)', () => {
    // The /sign-up waitlist form posts here from visitors who BY DEFINITION
    // have no Clerk session. If this pattern disappears, production 401s every
    // real submission before the route's own rate limit/honeypot/validation
    // ever run — the exact omission class this matcher suite exists to catch.
    expect(isPublic('/api/waitlist')).toBe(true);
    // Pin the trailing (.*) — any future sub-path (e.g. /api/waitlist/confirm)
    // must stay public too; an exact-match tightening would silently 401 it.
    expect(isPublic('/api/waitlist/confirm')).toBe(true);
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

  it('lets an unauthenticated POST through to the public waitlist endpoint (#8730)', async () => {
    const res = await applyAuthDecision(
      unauthed,
      reqFor('/api/waitlist', { method: 'POST' }),
      isPublicRoute,
    );
    expect(res.status).toBe(200);
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

describe('per-request CSP nonce on /play (PF-1018, #9038)', () => {
  const isPublicRoute = createRouteMatcher(buildPublicRoutes({ includeDev: false }));
  const unauthed = async () => ({
    userId: null,
    redirectToSignIn: () => new Response(null, { status: 307 }),
  });

  /**
   * Read the headers the proxy FORWARDS to the app.
   * `NextResponse.next({ request: { headers } })` encodes the rewritten request
   * as `x-middleware-override-headers` (the complete replacement set) plus one
   * `x-middleware-request-<name>` per value. Asserting on that encoding is what
   * makes "the page can read this nonce" and "a client cannot supply one"
   * testable at all — there is no other observable seam for a request rewrite.
   */
  function forwardedHeaders(res: Response): Headers {
    const names = res.headers.get('x-middleware-override-headers');
    const out = new Headers();
    if (!names) return out;
    for (const name of names.split(',').filter(Boolean)) {
      out.set(name, res.headers.get(`x-middleware-request-${name}`) ?? '');
    }
    return out;
  }

  /**
   * Assert a client-supplied header was STRIPPED, not merely unobservable.
   *
   * Checking `!forwardedHeaders(res).has(name)` alone is vacuous: if the proxy
   * skips the rewrite entirely, there is no override encoding to read, the
   * helper returns an empty set, and the assertion passes — while the original
   * attacker-supplied header flows through to the app untouched. That is the
   * vulnerable case, so the rewrite must be proven to have HAPPENED first.
   * (Verified by mutation: narrowing CLIENT_SPOOFABLE_HEADERS to `['x-nonce']`
   * passes the naive form of this check and fails this one.)
   */
  function expectStripped(res: Response, name: string) {
    expect(
      res.headers.get('x-middleware-override-headers'),
      'proxy did not rewrite the request, so nothing was stripped',
    ).not.toBeNull();
    expect(forwardedHeaders(res).has(name)).toBe(false);
  }

  const play = (init?: { headers?: Record<string, string> }) => {
    const req = reqFor('/play/user_abc/my-game');
    for (const [k, v] of Object.entries(init?.headers ?? {})) req.headers.set(k, v);
    return applyAuthDecision(unauthed, req, isPublicRoute);
  };

  it('identifies the play routes without matching a sibling prefix', () => {
    expect(isPlayPath('/play')).toBe(true);
    expect(isPlayPath('/play/user_abc/my-game')).toBe(true);
    expect(isPlayPath('/playground')).toBe(false);
    expect(isPlayPath('/community/play')).toBe(false);
  });

  it('emits a response CSP that authorizes inline scripts by nonce', async () => {
    // The defect: /play shipped a policy with neither a nonce nor
    // 'unsafe-inline', so Next.js's inline hydration bootstrap was blocked and
    // every published game rendered blank.
    const csp = (await play()).headers.get('Content-Security-Policy') ?? '';
    const script = csp.split(';').map((d) => d.trim()).find((d) => d.startsWith('script-src '));
    expect(script).toMatch(/'nonce-[A-Za-z0-9+/=]+'/);
    // Scoped to script-src: style-src legitimately keeps 'unsafe-inline'.
    expect(script).not.toContain("'unsafe-inline'");
    expect(script).toContain("'wasm-unsafe-eval'");
    expect(script).not.toContain(" 'unsafe-eval'");
  });

  it('hands the SAME nonce to the app as it advertises in the header', async () => {
    // A mismatch here is the silent failure mode: the header looks correct and
    // the page still renders blank because its own <script nonce> disagrees.
    const res = await play();
    const nonce = forwardedHeaders(res).get('x-nonce');
    expect(nonce).toBeTruthy();
    expect(res.headers.get('Content-Security-Policy')).toContain(`'nonce-${nonce}'`);
    // Next.js reads the nonce off the request CSP to stamp its OWN scripts.
    expect(forwardedHeaders(res).get('content-security-policy')).toBe(
      res.headers.get('Content-Security-Policy'),
    );
  });

  it('mints a fresh nonce per request', async () => {
    const [a, b] = await Promise.all([play(), play()]);
    expect(a.headers.get('Content-Security-Policy')).not.toBe(
      b.headers.get('Content-Security-Policy'),
    );
  });

  it('ignores a client-supplied nonce and CSP rather than trusting them', async () => {
    const res = await play({
      headers: { 'x-nonce': 'attacker-chosen', 'content-security-policy': 'script-src *' },
    });
    const fwd = forwardedHeaders(res);
    expect(fwd.get('x-nonce')).not.toBe('attacker-chosen');
    expect(res.headers.get('Content-Security-Policy')).not.toContain('attacker-chosen');
    expect(fwd.get('content-security-policy')).not.toBe('script-src *');
  });

  it('strips client-supplied nonce headers on non-play routes too', async () => {
    // Otherwise any page reading `x-nonce` would trust caller-controlled input.
    const req = reqFor('/community/games/1');
    req.headers.set('x-nonce', 'attacker-chosen');
    expectStripped(await applyAuthDecision(unauthed, req, isPublicRoute), 'x-nonce');
  });

  it('strips a client-supplied CSP on non-play routes even with no x-nonce', async () => {
    // `CLIENT_SPOOFABLE_HEADERS` treats both names identically, but the sibling
    // test above only supplies `x-nonce`. Without this case, a regression that
    // narrowed the strip to `x-nonce` alone would stay green while letting a
    // caller hand the app a `content-security-policy` request header of their
    // choosing — the exact input Next.js reads to nonce its bootstrap scripts.
    const req = reqFor('/community/games/1');
    req.headers.set('content-security-policy', 'script-src *');
    expectStripped(
      await applyAuthDecision(unauthed, req, isPublicRoute),
      'content-security-policy',
    );
  });

  it('applies the same nonce policy on the Clerk-less passthrough path', async () => {
    // `buildProxy()` falls back to passthroughMiddleware whenever Clerk keys are
    // absent or malformed — which is precisely how the DB-less E2E gate and any
    // mis-provisioned deployment run. Proving the nonce only on the Clerk path
    // would leave the branch CI actually exercises unverified.
    const res = passthroughMiddleware(reqFor('/play/user_abc/my-game'));
    const nonce = forwardedHeaders(res).get('x-nonce');
    expect(nonce).toBeTruthy();
    expect(res.headers.get('Content-Security-Policy')).toContain(`'nonce-${nonce}'`);
  });

  it('strips client-supplied nonce headers on the passthrough path too', async () => {
    const req = reqFor('/play/user_abc/my-game');
    req.headers.set('x-nonce', 'attacker-chosen');
    req.headers.set('content-security-policy', 'script-src *');
    const res = passthroughMiddleware(req);
    expect(forwardedHeaders(res).get('x-nonce')).not.toBe('attacker-chosen');
    expect(res.headers.get('Content-Security-Policy')).not.toContain('attacker-chosen');
  });

  it('leaves ordinary non-play requests untouched (no nonce, no CSP header)', async () => {
    // The static next.config.ts rules own CSP everywhere else; the proxy must
    // not start overriding them as a side effect of this fix.
    const res = await applyAuthDecision(unauthed, reqFor('/community/games/1'), isPublicRoute);
    expect(res.headers.get('Content-Security-Policy')).toBeNull();
    expect(res.headers.get('x-middleware-override-headers')).toBeNull();
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
