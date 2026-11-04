// @vitest-environment node
/**
 * The sanctions geo-block runs in the live `proxy` export, before auth (#9331).
 * With no Clerk keys in the test environment `proxy` uses the passthrough
 * branch, which is the branch CI's E2E runs; the block sits ahead of either.
 */
import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from '../proxy';

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
