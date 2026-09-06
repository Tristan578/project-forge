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
import { captureException } from '@/lib/monitoring/sentry-server';
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

  // E2E servers reach this route with Clerk keys present but outside
  // clerkMiddleware, where `auth()` throws; the shard that hit it saw a 500
  // instead of the anonymous body (#9725 CI). Availability never 500s on auth.
  it('degrades to the anonymous body when safeAuth itself throws, and reports it', async () => {
    mockAuth.mockRejectedValue(new Error('Clerk: auth() was called but clerkMiddleware() was not detected'));
    vi.stubEnv('PLATFORM_MESHY_KEY', 'msy_fake');
    const { body, res } = await call();
    expect(res.status).toBe(200);
    expect(status(body, 'model3d').available).toBe(true);
    expect(mockByok).not.toHaveBeenCalled();
    // Fail-open must never be silent (lesson 14).
    expect(vi.mocked(captureException)).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ route: '/api/capabilities', action: 'auth' }),
    );
  });

  // The DB-backed modules must be reached only through the lazy `import()`
  // inside resolveByokProviders: a static top-level import of either is what
  // 500'd the E2E shard (899ce813), and a mocked runtime cannot observe module
  // evaluation (vi.mock factories run once per file), so the source shape is
  // pinned directly — the same technique CLAUDE.md prescribes for
  // NEXT_PUBLIC_* member expressions.
  it('reaches the DB-backed modules only through dynamic import()', async () => {
    const { readFileSync } = await import('node:fs');
    const path = await import('node:path');
    const src = readFileSync(path.resolve(__dirname, '../route.ts'), 'utf8');
    for (const mod of ['@/lib/auth/user-service', '@/lib/keys/resolver']) {
      expect(src, `${mod} must not be a static import`).not.toMatch(
        new RegExp(String.raw`^\s*import\s+[^;]*from\s+'${mod}'`, 'm'),
      );
      expect(src, `${mod} must be imported lazily`).toContain(`import('${mod}')`);
    }
  });

  it.each(['replicate', 'openai'])('allows a sprite path with only its platform key (%s)', async (provider) => {
    vi.stubEnv(provider === 'replicate' ? 'PLATFORM_REPLICATE_KEY' : 'PLATFORM_OPENAI_KEY', 'key');
    const { body } = await call();
    const sprite = status(body, 'sprite');
    expect(sprite.available).toBe(true);
    expect(sprite.providerAvailability).toEqual({ replicate: provider === 'replicate', openai: provider === 'openai' });
    expect(sprite.requiredProviders).toBeUndefined();
  });

  it('names either provider when neither sprite path is available', async () => {
    const { body } = await call();
    const sprite = status(body, 'sprite');
    expect(sprite.available).toBe(false);
    expect(sprite.providerAvailability).toEqual({ replicate: false, openai: false });
    expect(sprite.requiredProviders).toEqual(['Replicate', 'OpenAI']);
    expect(sprite.hint).toContain('Replicate or OpenAI');
  });

  it.each(['replicate', 'openai'])('allows a sprite path with only its BYOK key (%s)', async (provider) => {
    signedInWithByok([provider]);
    const { body } = await call();
    expect(status(body, 'sprite').available).toBe(true);
    expect(status(body, 'sprite').providerAvailability).toEqual({ replicate: provider === 'replicate', openai: provider === 'openai' });
  });

  it('combines platform and BYOK sprite options per provider', async () => {
    vi.stubEnv('PLATFORM_REPLICATE_KEY', 'r8');
    signedInWithByok(['openai']);
    const { body } = await call();
    expect(status(body, 'sprite').providerAvailability).toEqual({ replicate: true, openai: true });
  });

  // Fail-open on the SERVER became fail-closed on the CLIENT: the route
  // returned 200 with available:false and "Configure Meshy API key in
  // Settings", and useGenerationGate disabled every entry point for a BYOK
  // user who already holds that key. The body must say the per-user half of
  // the answer is missing so the client can refuse to act on it (#9725 p7).
  it('marks the body degraded when the BYOK lookup throws', async () => {
    signedInWithByok([]);
    mockByok.mockRejectedValue(new Error('db down'));
    const { body } = await call();
    expect(body.degraded).toBe(true);
  });

  it('marks the body degraded when safeAuth throws', async () => {
    mockAuth.mockRejectedValue(new Error('clerkMiddleware not detected'));
    const { body } = await call();
    expect(body.degraded).toBe(true);
  });

  it('marks the body degraded when the user-row lookup throws', async () => {
    mockAuth.mockResolvedValue({ userId: CLERK_ID });
    mockUser.mockRejectedValue(new Error('circuit breaker open'));
    const { body } = await call();
    expect(body.degraded).toBe(true);
  });

  it.each([
    ['anonymous', () => {}],
    ['signed in with a healthy lookup', () => signedInWithByok(['meshy'])],
    ['signed in with no local user row', () => { mockAuth.mockResolvedValue({ userId: CLERK_ID }); mockUser.mockResolvedValue(null); }],
  ])('does not mark the body degraded when %s', async (_label, arrange) => {
    arrange();
    const { body } = await call();
    expect(body.degraded).toBe(false);
  });

  it('falls back to platform-only availability when the BYOK lookup throws', async () => {
    signedInWithByok([]);
    mockByok.mockRejectedValue(new Error('db down'));
    vi.stubEnv('PLATFORM_MESHY_KEY', 'msy_fake');
    const { body, res } = await call();
    expect(res.status).toBe(200);
    expect(status(body, 'model3d').available).toBe(true);
    expect(status(body, 'sfx').available).toBe(false);
    expect(vi.mocked(captureException)).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ route: '/api/capabilities', action: 'byok_lookup' }),
    );
  });
});
