// @vitest-environment node
/**
 * Site content is open to every country (#9331, owner decision 2026-11-16):
 * the live `proxy` export never refuses a request by country. Only the
 * purchase routes do (`src/app/api/__tests__/paymentGeoBlock.test.ts`). With
 * no Clerk keys in the test environment `proxy` uses the passthrough branch,
 * which is the branch CI's E2E runs.
 *
 * The matcher half of this file pins the proxy matcher fix made in the same
 * PR, which stands on its own: an extension-shaped dynamic page must still
 * reach the proxy (auth, header stripping).
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

describe('proxy serves every country (#9331: content open to all)', () => {
  it.each(['/', '/pricing', '/dashboard', '/community/games/1', '/blog/x.html', '/api/projects', '/api/marketplace/assets', '/play'])(
    'forwards %s from a listed country to the app',
    async (pathname) => {
      for (const [country, region] of [['IR'], ['RU'], ['KP'], ['UA', '43']] as const) {
        const headers: Record<string, string> = { 'x-vercel-ip-country': country };
        if (region) headers['x-vercel-ip-country-region'] = region;
        const res = await proxy(req(pathname, headers));
        expect(res.status, `${pathname} from ${country}`).not.toBe(451);
        expect(res.headers.get('x-middleware-next'), `${pathname} from ${country}`).toBe('1');
      }
    },
  );

  it('does not refuse a purchase route in the proxy either (the route itself decides)', async () => {
    const res = await proxy(req('/api/billing/checkout', { 'x-vercel-ip-country': 'IR' }, 'POST'));
    expect(res.status).not.toBe(451);
    expect(res.headers.get('x-middleware-next')).toBe('1');
  });

  it('forwards a request with no country header', async () => {
    const res = await proxy(req('/pricing'));
    expect(res.headers.get('x-middleware-next')).toBe('1');
  });
});

/**
 * A request the matcher excludes never reaches `proxy()`: no auth redirect,
 * no client-header stripping. The first matcher entry used to exclude any path containing
 * `.html`, `.js`, ... anywhere, which let `/editor/abc.html` and every other
 * dynamic page with an extension-shaped parameter render with no proxy at all.
 * The routes and the public files are derived from the tree on every run.
 */
describe('proxy matcher reaches every page, extension-shaped ones included', () => {
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

  it('still skips Next.js assets, Vercel endpoints, engine WASM, and the static files in public/', () => {
    expect(runsProxy('/_next/static/chunks/a.js')).toBe(false);
    expect(runsProxy('/_next/image')).toBe(false);
    // Loaded by the root layout on every page (Web Analytics, Speed Insights)
    // and their beacons: an auth redirect here would break both for anonymous
    // visitors. The top-level-only extension rule no longer covers these.
    for (const p of ['/_vercel/insights/script.js', '/_vercel/speed-insights/script.js', '/_vercel/insights/view', '/_vercel/speed-insights/vitals']) {
      expect(runsProxy(p), p).toBe(false);
    }
    expect(runsProxy('/engine-pkg-webgpu/forge_engine.js')).toBe(false);
    const extensionFiles = publicFiles.filter((n) => /\.(?:html?|css|js|jpe?g|webp|png|gif|svg|ttf|woff2?|ico)$/.test(n));
    expect(extensionFiles.length).toBeGreaterThan(3);
    for (const f of extensionFiles) expect(runsProxy(`/${f}`), f).toBe(false);
  });

  it('serves an extension-shaped dynamic page through the proxy from a listed country', async () => {
    const res = await proxy(req('/editor/abc.html', { 'x-vercel-ip-country': 'IR' }));
    expect(res.status).not.toBe(451);
    expect(res.headers.get('x-middleware-next')).toBe('1');
  });
});
