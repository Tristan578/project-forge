/** @vitest-environment node */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse, type NextFetchEvent } from 'next/server';
const authMocks = vi.hoisted(() => ({ middleware: vi.fn() }));
vi.mock('@clerk/nextjs/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@clerk/nextjs/server')>();
  return { ...actual, clerkMiddleware: vi.fn(() => authMocks.middleware) };
});
import proxy from '../../proxy';
const event = { waitUntil: vi.fn() } as unknown as NextFetchEvent;
const request = (path: string) => new NextRequest('https://docs.spawnforge.ai' + path);
const responseFor = async (path: string) => {
  const response = await proxy(request(path), event);
  expect(response).toBeInstanceOf(Response);
  if (!response) throw new Error('Proxy returned no response');
  return response;
};

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('CLERK_SECRET_KEY', 'test-server-credential');
  authMocks.middleware.mockReset();
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
describe('docs authentication failure policy (#10044)', () => {
  it.each(['/guides/setup', '/api/internal', '/mcpadmin', '/sign-internal'])('denies protected %s when Clerk throws', async (path) => {
    authMocks.middleware.mockRejectedValue(new Error('upstream token=private-provider-detail'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await responseFor(path);
    expect(response.status).toBe(503);
    expect(response.headers.get('x-middleware-next')).toBeNull();
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ error: 'Authentication temporarily unavailable' });
  });
  it.each(['/', '/mcp/commands', '/sign-in', '/robots.txt'])('keeps public %s available on an auth exception', async (path) => {
    authMocks.middleware.mockRejectedValue(new Error('secret=do-not-log'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await responseFor(path);
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });
  it('reports a fixed diagnostic without raw provider errors', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    authMocks.middleware.mockRejectedValue({ token: 'credential', message: 'provider detail' });
    await proxy(request('/guides/setup'), event);
    expect(spy.mock.calls).toEqual([['[docs-auth] middleware_unavailable']]);
  });
  it('preserves the response produced by working middleware', async () => {
    const redirect = NextResponse.redirect('https://docs.spawnforge.ai/sign-in');
    authMocks.middleware.mockResolvedValue(redirect);
    expect(await proxy(request('/guides/setup'), event)).toBe(redirect);
    expect(authMocks.middleware).toHaveBeenCalledWith(expect.any(NextRequest), event);
  });
  it('does not expose protected production content when the server key is missing', async () => {
    vi.stubEnv('CLERK_SECRET_KEY', '');
    const response = await responseFor('/guides/setup');
    expect(response.status).toBe(503);
    expect(authMocks.middleware).not.toHaveBeenCalled();
  });
  it('keeps public production content available without Clerk', async () => {
    vi.stubEnv('CLERK_SECRET_KEY', '');
    expect((await responseFor('/mcp')).headers.get('x-middleware-next')).toBe('1');
  });
  it('retains the explicitly supported unauthenticated development mode', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('CLERK_SECRET_KEY', '');
    expect((await responseFor('/guides/setup')).headers.get('x-middleware-next')).toBe('1');
    expect(authMocks.middleware).not.toHaveBeenCalled();
  });
});
