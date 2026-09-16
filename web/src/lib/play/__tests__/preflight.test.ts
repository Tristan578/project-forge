/** Real proxy-response contracts for published preflight and script-free404 documents. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { gameNotFoundResponse, gameUnavailableResponse } from '../notFoundDocument';

const { lookup } = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock('@/lib/play/gameMetadata', () => ({ loadPublishedGameMetadata: lookup }));

/** Load the actual proxy in its supported credential-free branch for each test. */
async function invoke(path: string, method = 'GET', headers?: Record<string, string>) {
  const { proxy } = await import('@/proxy');
  return proxy(new NextRequest('http://localhost:3000' + path, { method, headers }));
}

describe('published-game pre-stream response', () => {
  beforeEach(() => {
    vi.resetModules();
    lookup.mockReset().mockResolvedValue(null);
    vi.stubEnv('CLERK_SECRET_KEY', '');
    vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', '');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('returns real404 without routing controls while preserving security and CSP', async () => {
    const response = await invoke('/play/user_fixture/missing.html', 'GET', {
      'x-nonce': 'attacker-nonce', 'content-security-policy': "script-src *",
    });
    expect(response.status).toBe(404);
    expect(lookup).toHaveBeenCalledExactlyOnceWith('user_fixture', 'missing.html');
    expect([...response.headers.keys()].filter(name => name.startsWith('x-middleware-'))).toEqual([]);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('content-security-policy')).toContain("script-src 'self' 'nonce-");
    expect(response.headers.get('content-security-policy')).not.toContain('attacker-nonce');
    expect(response.headers.get('content-security-policy')).not.toContain('script-src *');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-robots-tag')).toBe('noindex');
    const html = await response.text();
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('<main>');
    expect(html).toContain('<title>Game Not Found - SpawnForge</title>');
    expect(html).toContain('role="alert"');
    expect(html).toContain('href="/"');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('VideoGame');
  });

  it.each([[gameNotFoundResponse, 404], [gameUnavailableResponse, 503]] as const)
  ('preserves multiple authenticated cookies and security headers for status %s', async (buildResponse, status) => {
    const source = NextResponse.next();
    source.headers.append('Set-Cookie', 'session=first; Path=/; HttpOnly; SameSite=Lax');
    source.headers.append('Set-Cookie', 'refresh=second; Path=/; HttpOnly; Secure');
    source.headers.set('Content-Security-Policy', "default-src 'self'; script-src 'nonce-trusted'");
    source.headers.set('X-Frame-Options', 'DENY');
    source.headers.set('X-Robots-Tag', 'noindex');
    source.headers.set('x-middleware-request-x-nonce', 'trusted');
    source.headers.set('x-middleware-override-headers', 'x-nonce');
    const cookies = source.headers.getSetCookie();
    expect(cookies).toHaveLength(2);
    const result = buildResponse(source, false);
    expect(result.status).toBe(status);
    expect(result.headers.getSetCookie()).toEqual(cookies);
    expect(result.headers.get('content-security-policy')).toBe(source.headers.get('content-security-policy'));
    expect(result.headers.get('x-frame-options')).toBe('DENY');
    expect(result.headers.get('x-robots-tag')).toBe(status === 503 ? null : 'noindex');
    expect(source.headers.get('x-robots-tag')).toBe('noindex');
    expect([...result.headers.keys()].filter(name => name.startsWith('x-middleware-'))).toEqual([]);
    expect(source.headers.get('x-middleware-next')).toBe('1');
  });

  it('preserves the actual published-page passthrough response', async () => {
    lookup.mockResolvedValue({ title: 'Published', description: null, createdAt: new Date(0), authorName: null });
    const response = await invoke('/play/user_fixture/live-game');
    expect(lookup).toHaveBeenCalledExactlyOnceWith('user_fixture', 'live-game');
    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-next')).toBe('1');
    expect(response.headers.get('x-middleware-request-x-nonce')).toBeTruthy();
    expect(response.headers.get('content-security-policy')).toContain("'nonce-");
    expect(await response.text()).toBe('');
  });

  it.each(['GET', 'HEAD'])('returns a retryable503 rather than404 when lookup fails: %s', async method => {
    lookup.mockRejectedValue(new Error('secret database connection string'));
    const response = await invoke('/play/user_fixture/live-game', method);
    expect(response.status).toBe(503);
    expect(response.headers.get('retry-after')).toBe('60');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-robots-tag')).toBeNull();
    expect(response.headers.get('content-security-policy')).toContain("script-src 'self' 'nonce-");
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect([...response.headers.keys()].filter(name => name.startsWith('x-middleware-'))).toEqual([]);
    const html = await response.text();
    if (method === 'HEAD') {
      expect(response.body).toBeNull();
      expect(html).toBe('');
    } else {
      expect(html).toContain('<title>Game Temporarily Unavailable - SpawnForge</title>');
      expect(html).toContain('<h1>Game Temporarily Unavailable</h1>');
      expect(html).not.toContain('<h1>Game Not Found</h1>');
      expect(html).toContain('Please try again shortly.');
      expect(html).not.toContain('noindex');
      expect(html).not.toContain('secret database');
      expect(html).not.toContain('<script');
    }
  });

  it('returns404 for HEAD with no body', async () => {
    const response = await invoke('/play/user_fixture/missing', 'HEAD');
    expect(response.status).toBe(404);
    expect(response.body).toBeNull();
    expect(await response.text()).toBe('');
  });

  it('decodes each author/slug segment exactly once', async () => {
    await invoke('/play/user%20fixture/a%2520game/');
    expect(lookup).toHaveBeenCalledExactlyOnceWith('user fixture', 'a%20game');
  });

  it.each(['/play', '/play/user', '/play/user/slug/opengraph-image', '/playground/user/slug', '/community', '/play/%ZZ/slug'])
  ('does not preflight a different or malformed route: %s', async path => {
    const response = await invoke(path);
    expect(lookup).not.toHaveBeenCalled();
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });

  it('keeps other methods and CORS short circuits outside the lookup', async () => {
    await invoke('/play/user/slug', 'POST');
    const cors = await invoke('/api/play/user/slug', 'GET', { origin: 'https://untrusted.invalid' });
    expect(cors.status).toBe(403);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('returns a direct HTML404 for an RSC missing navigation', async () => {
    const response = await invoke('/play/user/missing', 'GET', { rsc: '1' });
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('text/html');
  });
});


describe('published-game preflight after Clerk forwarding (PF-381)', () => {
  beforeEach(() => {
    vi.resetModules();
    lookup.mockReset().mockResolvedValue(null);
    vi.stubEnv('CLERK_SECRET_KEY', '');
    vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', '');
  });
  afterEach(() => vi.unstubAllEnvs());

  // Clerk's decorateRequest removes x-middleware-next and rewrites to req.url
  // to carry its auth request headers. This is still the original document.
  function clerkForward(req: NextRequest) {
    const response = NextResponse.rewrite(new URL(req.url));
    response.headers.set('Content-Security-Policy', "default-src 'self'; script-src 'nonce-trusted'");
    response.headers.set('X-Frame-Options', 'DENY');
    response.headers.append('Set-Cookie', 'session=first; Path=/; HttpOnly');
    return response;
  }

  it.each(['GET', 'HEAD'])('returns404 after same-URL Clerk forwarding: %s', async method => {
    const { preflightPublishedGame } = await import('@/proxy');
    const req = new NextRequest('https://www.spawnforge.ai/play/user_missing/missing.html?check=1', { method });
    const original = clerkForward(req);
    expect(original.headers.get('x-middleware-next')).toBeNull();
    const response = await preflightPublishedGame(req, original);
    expect(response.status).toBe(404);
    expect(lookup).toHaveBeenCalledExactlyOnceWith('user_missing', 'missing.html');
    expect(response.headers.get('x-robots-tag')).toBe('noindex');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-security-policy')).toBe(original.headers.get('content-security-policy'));
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.getSetCookie()).toEqual(original.headers.getSetCookie());
    expect([...response.headers.keys()].filter(name => name.startsWith('x-middleware-'))).toEqual([]);
    if (method === 'HEAD') {
      expect(response.body).toBeNull();
    } else {
      expect(await response.text()).toContain('<h1>Game Not Found</h1>');
    }
  });

  it('preserves Clerk forwarding for an existing published game', async () => {
    const { preflightPublishedGame } = await import('@/proxy');
    lookup.mockResolvedValue({ title: 'Published' });
    const req = new NextRequest('https://www.spawnforge.ai/play/user_fixture/live-game');
    const original = clerkForward(req);
    expect(await preflightPublishedGame(req, original)).toBe(original);
    expect(lookup).toHaveBeenCalledExactlyOnceWith('user_fixture', 'live-game');
  });

  it.each(['GET', 'HEAD'])('returns retryable503 on a failed lookup after Clerk forwarding: %s', async method => {
    const { preflightPublishedGame } = await import('@/proxy');
    lookup.mockRejectedValue(new Error('secret connection string'));
    const req = new NextRequest('https://www.spawnforge.ai/play/user_fixture/live-game', { method });
    const response = await preflightPublishedGame(req, clerkForward(req));
    expect(response.status).toBe(503);
    expect(response.headers.get('retry-after')).toBe('60');
    expect(response.headers.get('x-robots-tag')).toBeNull();
    expect(await response.text()).not.toContain('secret connection string');
  });

  it.each([
    'https://www.spawnforge.ai/sign-in',
    'https://www.spawnforge.ai/play/user_fixture/other-game',
    'https://www.spawnforge.ai/play/user_fixture/live-game?other=1',
    'https://external.invalid/play/user_fixture/live-game',
  ])('preserves rewrites to another destination: %s', async destination => {
    const { preflightPublishedGame } = await import('@/proxy');
    const req = new NextRequest('https://www.spawnforge.ai/play/user_fixture/live-game');
    const original = NextResponse.rewrite(new URL(destination));
    original.headers.set('x-middleware-next', '1');
    expect(await preflightPublishedGame(req, original)).toBe(original);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('preserves redirects and ordinary200 response bodies', async () => {
    const { preflightPublishedGame } = await import('@/proxy');
    const req = new NextRequest('https://www.spawnforge.ai/play/user_fixture/live-game');
    for (const original of [NextResponse.redirect(new URL('/sign-in', req.url)), new NextResponse('Auth decision')]) {
      expect(await preflightPublishedGame(req, original)).toBe(original);
    }
    expect(lookup).not.toHaveBeenCalled();
  });

  it.each([['/community', 'GET'], ['/play/user_fixture/live-game', 'POST']] as const)
  ('does not preflight other forwarded routes or methods: %s %s', async (path, method) => {
    const { preflightPublishedGame } = await import('@/proxy');
    const req = new NextRequest('https://www.spawnforge.ai' + path, { method });
    const original = clerkForward(req);
    expect(await preflightPublishedGame(req, original)).toBe(original);
    expect(lookup).not.toHaveBeenCalled();
  });
});


describe('actual authenticated proxy factory with anonymous Clerk transport (PF-381)', () => {
  const blockedFetch = vi.fn(() => Promise.reject(new Error('Anonymous proxy tests must not call provider APIs')));

  beforeEach(() => {
    vi.resetModules();
    lookup.mockReset().mockResolvedValue(null);
    blockedFetch.mockClear();
    vi.stubGlobal('fetch', blockedFetch);
    vi.stubEnv('NODE_ENV', 'production');
    // Valid-shaped fixtures exercise Clerk's real signed-out transport without
    // authenticating a user, contacting Clerk, or using any real credentials.
    vi.stubEnv('CLERK_SECRET_KEY', 'sk_live_anonymous_transport_fixture_not_a_real_key');
    vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY',
      'pk_live_' + Buffer.from('fixture.clerk.accounts.dev$').toString('base64'));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it.each(['GET', 'HEAD'])('returns404 through the real Clerk middleware for %s', async method => {
    const response = await invoke('/play/user_fixture/missing', method);
    expect(response.status).toBe(404);
    expect(response.headers.get('x-clerk-auth-status')).toBe('signed-out');
    expect(response.headers.get('x-robots-tag')).toBe('noindex');
    expect(response.headers.get('x-middleware-rewrite')).toBeNull();
    expect(lookup).toHaveBeenCalledExactlyOnceWith('user_fixture', 'missing');
    expect(blockedFetch).not.toHaveBeenCalled();
    if (method === 'HEAD') expect(response.body).toBeNull();
  });

  it('retains the real Clerk forwarding response for a published game', async () => {
    lookup.mockResolvedValue({ title: 'Published' });
    const response = await invoke('/play/user_fixture/live-game');
    expect(response.status).toBe(200);
    expect(response.headers.get('x-clerk-auth-status')).toBe('signed-out');
    expect(response.headers.get('x-middleware-next')).toBeNull();
    expect(response.headers.get('x-middleware-rewrite')).toBe('http://localhost:3000/play/user_fixture/live-game');
    expect(lookup).toHaveBeenCalledExactlyOnceWith('user_fixture', 'live-game');
    expect(blockedFetch).not.toHaveBeenCalled();
  });

  it('returns503 for failed metadata lookup through the real Clerk middleware', async () => {
    lookup.mockRejectedValue(new Error('secret connection string'));
    const response = await invoke('/play/user_fixture/live-game');
    expect(response.status).toBe(503);
    expect(response.headers.get('x-clerk-auth-status')).toBe('signed-out');
    expect(response.headers.get('retry-after')).toBe('60');
    expect(response.headers.get('x-middleware-rewrite')).toBeNull();
    expect(response.headers.get('x-robots-tag')).toBeNull();
    expect(await response.text()).not.toContain('secret connection string');
    expect(blockedFetch).not.toHaveBeenCalled();
  });
});
