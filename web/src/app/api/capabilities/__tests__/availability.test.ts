/**
 * GET /api/capabilities — availability semantics beyond "is the env var set"
 * (#9117 / #9522).
 *
 *  - A capability declared in UNAVAILABLE_CAPABILITIES reports available:false
 *    even when its platform key IS set; `hint` is the user-facing reason and
 *    `issue` the tracking issue (never interpolated into the hint).
 *  - A signed-in user's own (BYOK) key makes the capabilities that provider
 *    serves available. `safeAuth()` yields the CLERK id; providerKeys is keyed
 *    on the INTERNAL users.id, so the route must translate through
 *    `getUserByClerkId` — passing the Clerk id straight through fails uuid
 *    parsing on every call (#9725 review).
 *  - The body can differ per session, so no response may carry a shared-cache
 *    directive: a CDN keys on the URL, not the cookie.
 *  - A failing lookup degrades to platform-only rather than a 500.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { CapabilitiesResponse } from '../route';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/safe-auth', () => ({
  safeAuth: vi.fn(async () => ({ userId: null })),
}));
vi.mock('@/lib/auth/user-service', () => ({
  getUserByClerkId: vi.fn(async () => null),
}));
vi.mock('@/lib/keys/resolver', () => ({
  listConfiguredProviders: vi.fn(async () => []),
}));
vi.mock('@/lib/monitoring/sentry-server', () => ({
  captureException: vi.fn(),
}));

import { safeAuth } from '@/lib/auth/safe-auth';
import { getUserByClerkId } from '@/lib/auth/user-service';
import { listConfiguredProviders } from '@/lib/keys/resolver';

const mockAuth = vi.mocked(safeAuth);
const mockUser = vi.mocked(getUserByClerkId);
const mockByok = vi.mocked(listConfiguredProviders);

const CLERK_ID = 'user_2abc';
const INTERNAL_ID = '0f3c4c2e-7d2a-4c1e-9b8f-2b1e6a0c5d11';

async function call(): Promise<{ body: CapabilitiesResponse; res: Response }> {
  const mod = await import('../route');
  const res = await mod.GET(new NextRequest('http://localhost/api/capabilities'));
  return { body: await res.json(), res };
}

function status(body: CapabilitiesResponse, cap: string) {
  const row = body.capabilities.find((c) => c.capability === cap);
  if (!row) throw new Error(`no row for ${cap}`);
  return row;
}

function signedInWithByok(providers: string[]) {
  mockAuth.mockResolvedValue({ userId: CLERK_ID });
  mockUser.mockResolvedValue({ id: INTERNAL_ID } as never);
  mockByok.mockResolvedValue(providers.map((provider) => ({ provider: provider as never, createdAt: new Date() })));
}

describe('GET /api/capabilities availability', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    mockAuth.mockResolvedValue({ userId: null });
    mockUser.mockResolvedValue(null);
    mockByok.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('reports music unavailable even when PLATFORM_SUNO_KEY is set, with the reason as hint and the issue separate', async () => {
    vi.stubEnv('PLATFORM_SUNO_KEY', 'suno_fake');
    const { body } = await call();
    const music = status(body, 'music');
    expect(music.available).toBe(false);
    expect(music.unprovisionable).toBe(true);
    expect(music.issue).toBe(9522);
    expect(music.hint).toMatch(/not available yet/i);
    expect(music.hint).not.toMatch(/#\d+|PLATFORM_|Suno/);
    expect(body.unavailable).toContain('music');
  });

  it('resolves the Clerk id to the internal user id before querying BYOK keys', async () => {
    signedInWithByok(['meshy']);
    const { body } = await call();
    expect(mockUser).toHaveBeenCalledWith(CLERK_ID);
    expect(mockByok).toHaveBeenCalledWith(INTERNAL_ID);
    expect(mockByok).not.toHaveBeenCalledWith(CLERK_ID);
    expect(status(body, 'model3d').available).toBe(true);
    expect(status(body, 'texture').available).toBe(true);
    expect(status(body, 'sfx').available).toBe(false);
  });

  it('treats a Clerk identity with no local user row as platform-only', async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_ID });
    mockUser.mockResolvedValue(null);
    const { body } = await call();
    expect(mockByok).not.toHaveBeenCalled();
    expect(status(body, 'model3d').available).toBe(false);
  });

  it('does not let a BYOK key override an unprovisionable capability', async () => {
    signedInWithByok(['suno']);
    const { body } = await call();
    expect(status(body, 'music').available).toBe(false);
  });

  it('never emits a shared-cache directive, signed in or anonymous', async () => {
    const anon = await call();
    expect(anon.res.headers.get('Cache-Control')).toContain('private');
    expect(anon.res.headers.get('Cache-Control')).not.toMatch(/public|s-maxage/);

    signedInWithByok(['meshy']);
    const signedIn = await call();
    expect(signedIn.res.headers.get('Cache-Control')).toContain('private');
    expect(signedIn.res.headers.get('Cache-Control')).not.toMatch(/public|s-maxage/);
  });

  it('falls back to platform-only availability when the BYOK lookup throws', async () => {
    signedInWithByok([]);
    mockByok.mockRejectedValue(new Error('db down'));
    vi.stubEnv('PLATFORM_MESHY_KEY', 'msy_fake');
    const { body, res } = await call();
    expect(res.status).toBe(200);
    expect(status(body, 'model3d').available).toBe(true);
    expect(status(body, 'sfx').available).toBe(false);
  });
});
