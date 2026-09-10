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

  // ONE KEY IS NOT ENOUGH, and the breakdown says which one is there. `sprite`
  // resolves its provider per request — `provider: 'auto'` picks DALL-E 3 for
  // every style but pixel-art — so a Replicate-only deployment still fails the
  // default path, and offering the capability would be offering a 500. This
  // case used to assert the opposite (available with either key alone), which
  // was the any-provider rule this branch carried before main's landed.
  it.each(['replicate', 'openai'])('reports sprite unavailable with only one platform key, naming which path is present (%s)', async (provider) => {
    vi.stubEnv(provider === 'replicate' ? 'PLATFORM_REPLICATE_KEY' : 'PLATFORM_OPENAI_KEY', 'key');
    const { body } = await call();
    const sprite = status(body, 'sprite');
    expect(sprite.available).toBe(false);
    // #9719's contribution, and the reason it survives main's stricter rule:
    // the aggregate says "do not offer this", the breakdown says what is
    // missing, and a dialog needs both to explain itself.
    expect(sprite.providerAvailability).toEqual({ replicate: provider === 'replicate', openai: provider === 'openai' });
  });

  // Naming every env var the capability CAN spend told a Replicate-only
  // deployment to "Configure Replicate" — the key it already had — and never
  // named OpenAI (lesson 1 family). These two cases are the pair: one key
  // present names only the other, no keys names both.
  it('names only the missing provider for sprite in a Replicate-only environment', async () => {
    vi.stubEnv('PLATFORM_REPLICATE_KEY', 'r8');
    const { body } = await call();
    const sprite = status(body, 'sprite');
    expect(sprite.available).toBe(false);
    expect(sprite.providerAvailability).toEqual({ replicate: true, openai: false });
    expect(sprite.requiredProviders).toEqual(['OpenAI']);
    expect(sprite.hint).toContain('OpenAI');
    expect(sprite.hint).not.toContain('Replicate');
    // NOT "in Settings": OpenAI is not a BYOK provider, so /api/keys/openai
    // rejects it and ApiKeyManager renders no field for it. Saying "Settings"
    // sent the user to a page where the named key cannot be added — a dead end
    // dressed as an instruction (#9725 p8).
    expect(sprite.hint).not.toContain('Settings');
    expect(sprite.byokConfigurable).toBe(false);
  });

  it('names every missing provider for sprite when neither key is present', async () => {
    const { body } = await call();
    const sprite = status(body, 'sprite');
    expect(sprite.available).toBe(false);
    expect(sprite.providerAvailability).toEqual({ replicate: false, openai: false });
    expect(sprite.requiredProviders).toEqual(expect.arrayContaining(['Replicate', 'OpenAI']));
    expect(sprite.requiredProviders).toHaveLength(2);
    expect(sprite.hint).toContain('Replicate');
    expect(sprite.hint).toContain('OpenAI');
    expect(sprite.hint).not.toContain('Settings');
    expect(sprite.byokConfigurable).toBe(false);
  });

  it.each(['replicate', 'openai'])('ignores unsupported sprite BYOK rows (%s)', async (provider) => {
    signedInWithByok([provider]);
    const { body } = await call();
    const sprite = status(body, 'sprite');
    expect(sprite.available).toBe(false);
    expect(sprite.providerAvailability).toEqual({ replicate: false, openai: false });
    expect(sprite.requiredProviders).toEqual(expect.arrayContaining(['Replicate', 'OpenAI']));
    expect(sprite.requiredProviders).toHaveLength(2);
    expect(sprite.hint).toContain('Replicate');
    expect(sprite.hint).toContain('OpenAI');
    expect(sprite.hint).not.toContain('Settings');
    expect(sprite.byokConfigurable).toBe(false);
  });

  // The client renders its "Open Settings" affordance from this flag alone, so
  // it must be true exactly when /api/keys/[provider] would accept the key the
  // capability is missing (#9725 p8).
  it.each([
    ['sfx', true],
    ['model3d', true],
    ['music', undefined],
    ['sprite', false],
    ['image', false],
    ['bg_removal', false],
  ] as const)('marks %s byokConfigurable=%s on a key-less deployment', async (cap, expected) => {
    const { body } = await call();
    const row = status(body, cap);
    expect(row.available).toBe(false);
    expect(row.byokConfigurable).toBe(expected);
  });

  it('offers Settings in the hint only for a capability Settings can actually fix', async () => {
    const { body } = await call();
    expect(status(body, 'sfx').hint).toContain('Settings');
    expect(status(body, 'bg_removal').hint).toContain('only this deployment can configure');
    expect(status(body, 'bg_removal').hint).not.toContain('Settings');
  });

  it('does not advertise unsupported BYOK options beside a platform key', async () => {
    vi.stubEnv('PLATFORM_REPLICATE_KEY', 'r8');
    signedInWithByok(['openai']);
    const { body } = await call();
    expect(status(body, 'sprite').providerAvailability).toEqual({ replicate: true, openai: false });
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
