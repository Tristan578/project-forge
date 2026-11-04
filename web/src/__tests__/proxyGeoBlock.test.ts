// @vitest-environment node
/**
 * The sanctions geo-block runs in the live `proxy` export, before auth (#9331).
 * With no Clerk keys in the test environment `proxy` uses the passthrough
 * branch, which is the branch CI's E2E runs; the block sits ahead of either.
 */
import { readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy, config } from '../proxy';

// Next.js's own compiler for `config.matcher`, so the test sees exactly the
// paths Next.js runs the proxy on rather than a re-implementation of it.
// `getMiddlewareMatchers` is exported at runtime but not in Next's .d.ts, so
// both are loaded untyped and given the narrow shape used here.
type RouteMatch = (pathname: string, request: unknown, query: Record<string, never>) => boolean;
const nextRequire = createRequire(import.meta.url);
const { getMiddlewareMatchers } = nextRequire('next/dist/build/analysis/get-page-static-info') as {
  getMiddlewareMatchers: (matcher: string[], nextConfig: { basePath: string; i18n: null }) => unknown[];
};
const { getMiddlewareRouteMatcher } = nextRequire('next/dist/shared/lib/router/utils/middleware-route-matcher') as {
  getMiddlewareRouteMatcher: (matchers: unknown[]) => RouteMatch;
};

vi.mock('server-only', () => ({}));

function req(pathname: string, headers: Record<string, string> = {}, method = 'GET'): NextRequest {
  return new NextRequest(`https://www.spawnforge.ai${pathname}`, { method, headers });
}

describe('proxy sanctions geo-block (#9331)', () => {
  it.each(['/', '/pricing', '/dashboard', '/community/games/1', '/api/projects', '/api/billing/checkout'])(
    'answers 451 for %s from a blocked country',
    async (pathname) => {
      const res = await proxy(req(pathname, { 'x-vercel-ip-country': 'IR' }));
      expect(res.status).toBe(451);
      expect(res.headers.get('cache-control')).toBe('private, no-store');
      // Not forwarded to the app: no Next.js passthrough marker.
      expect(res.headers.get('x-middleware-next')).toBeNull();
    },
  );

  it('blocks a listed region and not the rest of its country', async () => {
    expect((await proxy(req('/', { 'x-vercel-ip-country': 'UA', 'x-vercel-ip-country-region': '43' }))).status).toBe(451);
    const kyiv = await proxy(req('/', { 'x-vercel-ip-country': 'UA', 'x-vercel-ip-country-region': '30' }));
    expect(kyiv.status).toBe(200);
    expect(kyiv.headers.get('x-middleware-next')).toBe('1');
  });

  it('passes an allowed country through to the app', async () => {
    const res = await proxy(req('/pricing', { 'x-vercel-ip-country': 'US' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('x-middleware-next')).toBe('1');
  });

  it.each(['/api/health', '/api/status', '/api/stripe/webhook', '/api/auth/webhook', '/api/cron/health-monitor', '/api/webhooks/generation-complete'])(
    'never blocks the bypass path %s by country',
    async (pathname) => {
      const res = await proxy(req(pathname, { 'x-vercel-ip-country': 'IR' }, 'POST'));
      expect(res.status).not.toBe(451);
    },
  );
});

/**
 * A request the matcher excludes never reaches `proxy()`, so it is never
 * geo-blocked. The first matcher entry used to exclude any path containing
 * `.html`, `.js`, ... anywhere, which let `/editor/abc.html` and every other
 * dynamic page with an extension-shaped parameter render with no proxy at all.
 * The routes and the public files are derived from the tree on every run.
 */
describe('proxy matcher reaches every page the geo-block must cover (#9331)', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const appDir = path.resolve(here, '../app');
  const publicDir = path.resolve(here, '../../public');
  const matches = getMiddlewareRouteMatcher(getMiddlewareMatchers(config.matcher, { basePath: '', i18n: null }));
  const runsProxy = (pathname: string) => matches(pathname, { headers: {}, cookies: {} }, {});

  /** URL paths of every page whose route has a dynamic segment, with `x.html` in each. */
  function dynamicPagePaths(dir: string, segments: string[] = []): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (!statSync(full).isDirectory()) {
        if (/^page\.(tsx|ts|jsx|js|mdx)$/.test(name) && segments.some((s) => s.includes('x.html'))) {
          out.push(`/${segments.join('/')}`);
        }
        continue;
      }
      if (name === '__tests__' || name === 'api' || name.startsWith('_') || name.startsWith('@')) continue;
      if (name.startsWith('(') && name.endsWith(')')) { out.push(...dynamicPagePaths(full, segments)); continue; }
      out.push(...dynamicPagePaths(full, [...segments, name.startsWith('[') ? 'x.html' : name]));
    }
    return out;
  }

  const dynamicPages = dynamicPagePaths(appDir);
  const publicFiles = readdirSync(publicDir).filter((n) => statSync(path.join(publicDir, n)).isFile());

  it('finds the routes and files it is meant to check (vacuity guard)', () => {
    expect(dynamicPages).toEqual(expect.arrayContaining(['/editor/x.html', '/blog/x.html', '/play/x.html/x.html']));
    expect(publicFiles.length).toBeGreaterThan(5);
  });

  it('has no dynamic segment at the top level, which the extension exclusion would skip', () => {
    expect(readdirSync(appDir).filter((n) => n.startsWith('['))).toEqual([]);
  });

  it.each(dynamicPages)('runs the proxy for the extension-shaped page %s', (pathname) => {
    expect(runsProxy(pathname)).toBe(true);
  });

  it.each(['/', '/pricing', '/docs/a.html/b', '/community/x.css', '/api/x.js'])('runs the proxy for %s', (pathname) => {
    expect(runsProxy(pathname)).toBe(true);
  });

  it('still skips Next.js assets, engine WASM, and the static files in public/', () => {
    expect(runsProxy('/_next/static/chunks/a.js')).toBe(false);
    expect(runsProxy('/engine-pkg-webgpu/forge_engine.js')).toBe(false);
    const extensionFiles = publicFiles.filter((n) => /\.(?:html?|css|js|jpe?g|webp|png|gif|svg|ttf|woff2?|ico)$/.test(n));
    expect(extensionFiles.length).toBeGreaterThan(3);
    for (const f of extensionFiles) expect(runsProxy(`/${f}`), f).toBe(false);
  });

  it('geo-blocks an extension-shaped dynamic page end to end', async () => {
    const res = await proxy(req('/editor/abc.html', { 'x-vercel-ip-country': 'IR' }));
    expect(res.status).toBe(451);
  });
});
