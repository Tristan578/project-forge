/**
 * GET /api/capabilities — availability semantics beyond "is the env var set"
 * (#9117 / #9522).
 *
 *  - A capability declared in UNAVAILABLE_CAPABILITIES reports available:false
 *    even when its platform key IS set, and its hint names the tracking issue.
 *  - A signed-in user's own (BYOK) key makes the capabilities that provider
 *    serves available, because that is exactly what resolveApiKey honours.
 *  - BYOK-aware responses are private; anonymous responses stay cacheable.
 *  - A failing BYOK lookup degrades to platform-only rather than a 500.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { CapabilitiesResponse } from '../route';

vi.mock('@/lib/auth/safe-auth', () => ({
  safeAuth: vi.fn(async () => ({ userId: null })),
}));
vi.mock('@/lib/keys/resolver', () => ({
  listConfiguredProviders: vi.fn(async () => []),
}));

import { safeAuth } from '@/lib/auth/safe-auth';
import { listConfiguredProviders } from '@/lib/keys/resolver';

const mockAuth = vi.mocked(safeAuth);
const mockByok = vi.mocked(listConfiguredProviders);

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

describe('GET /api/capabilities availability', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    mockAuth.mockResolvedValue({ userId: null });
    mockByok.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('reports music unavailable even when PLATFORM_SUNO_KEY is set', async () => {
    vi.stubEnv('PLATFORM_SUNO_KEY', 'suno_fake');
    const { body } = await call();
    const music = status(body, 'music');
    expect(music.available).toBe(false);
    expect(music.unprovisionable).toBe(true);
    expect(music.hint).toContain('#9522');
    expect(body.unavailable).toContain('music');
  });

  it('marks a capability available when the signed-in user holds a BYOK key for its provider', async () => {
    mockAuth.mockResolvedValue({ userId: 'user_1' });
    mockByok.mockResolvedValue([{ provider: 'meshy', createdAt: new Date() }]);
    const { body } = await call();
    expect(status(body, 'model3d').available).toBe(true);
    expect(status(body, 'texture').available).toBe(true);
    expect(status(body, 'sfx').available).toBe(false);
    expect(mockByok).toHaveBeenCalledWith('user_1');
  });

  it('does not let a BYOK key override an unprovisionable capability', async () => {
    mockAuth.mockResolvedValue({ userId: 'user_1' });
    mockByok.mockResolvedValue([{ provider: 'suno', createdAt: new Date() }]);
    const { body } = await call();
    expect(status(body, 'music').available).toBe(false);
  });

  it('serves BYOK-aware responses as private and anonymous ones as public', async () => {
    const anon = await call();
    expect(anon.res.headers.get('Cache-Control')).toContain('public');

    mockAuth.mockResolvedValue({ userId: 'user_1' });
    const signedIn = await call();
    expect(signedIn.res.headers.get('Cache-Control')).toContain('private');
    expect(signedIn.res.headers.get('Cache-Control')).not.toContain('public');
  });

  it('falls back to platform-only availability when the BYOK lookup throws', async () => {
    mockAuth.mockResolvedValue({ userId: 'user_1' });
    mockByok.mockRejectedValue(new Error('db down'));
    vi.stubEnv('PLATFORM_MESHY_KEY', 'msy_fake');
    const { body, res } = await call();
    expect(res.status).toBe(200);
    expect(status(body, 'model3d').available).toBe(true);
    expect(status(body, 'sfx').available).toBe(false);
  });
});
