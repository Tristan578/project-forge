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
    source.headers.set('x-middleware-request-x-nonce', 'trusted');
    source.headers.set('x-middleware-override-headers', 'x-nonce');
    const cookies = source.headers.getSetCookie();
    expect(cookies).toHaveLength(2);
    const result = buildResponse(source, false);
    expect(result.status).toBe(status);
    expect(result.headers.getSetCookie()).toEqual(cookies);
    expect(result.headers.get('content-security-policy')).toBe(source.headers.get('content-security-policy'));
    expect(result.headers.get('x-frame-options')).toBe('DENY');
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
      expect(html).toContain('Game Temporarily Unavailable');
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
