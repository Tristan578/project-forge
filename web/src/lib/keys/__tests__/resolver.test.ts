/**
 * Tests for BYOK key resolver.
 *
 * Covers: BYOK key resolution, platform key fallback, tier gating,
 * token deduction, storeProviderKey, deleteProviderKey, listConfiguredProviders.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockDbChain = {
  select: vi.fn(),
  insert: vi.fn(),
  delete: vi.fn(),
};

function makeSelectChain(rows: unknown[]) {
  return {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(rows),
  };
}

function makeInsertChain() {
  return {
    values: vi.fn().mockReturnThis(),
    onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
  };
}

function makeDeleteChain() {
  return {
    where: vi.fn().mockResolvedValue(undefined),
  };
}

vi.mock('@/lib/db/client', () => ({
  getDb: vi.fn(() => mockDbChain),
  queryWithResilience: vi.fn((fn: () => unknown) => fn()),
}));

vi.mock('@/lib/db/schema', () => ({
  users: { id: 'id', tier: 'tier', monthlyTokens: 'monthlyTokens', monthlyTokensUsed: 'monthlyTokensUsed', addonTokens: 'addonTokens' },
  providerKeys: { userId: 'userId', provider: 'provider', encryptedKey: 'encryptedKey', iv: 'iv', createdAt: 'createdAt' },
}));

vi.mock('@/lib/keys/encryption', () => ({
  decryptProviderKey: vi.fn((encKey: string, _iv: string) => `decrypted:${encKey}`),
  encryptProviderKey: vi.fn(() => ({ encrypted: 'enc-abc', iv: 'iv-abc' })),
}));

vi.mock('@/lib/tokens/service', () => ({
  deductTokens: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Subject + imported mocks for assertion
// ---------------------------------------------------------------------------

import { resolveApiKey, resolveByokOrPlatformKey, storeProviderKey, deleteProviderKey, listConfiguredProviders, ApiKeyError } from '@/lib/keys/resolver';
import { STATUS_CHECK_OPERATION } from '@/lib/keys/statusCheckOperation';
import * as dbClient from '@/lib/db/client';
import * as encryption from '@/lib/keys/encryption';
import * as tokenService from '@/lib/tokens/service';

const mockDeductTokens = vi.mocked(tokenService.deductTokens);
const mockGetDb = vi.mocked(dbClient.getDb);
const mockQueryWithResilience = vi.mocked(dbClient.queryWithResilience);
const mockDecryptProviderKey = vi.mocked(encryption.decryptProviderKey);
const mockEncryptProviderKey = vi.mocked(encryption.encryptProviderKey);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBYOKKey() {
  return { userId: 'user-1', provider: 'meshy', encryptedKey: 'encrypted-meshy-key', iv: 'iv-xyz' };
}

function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-1',
    tier: 'hobbyist',
    monthlyTokens: 300,
    monthlyTokensUsed: 100,
    addonTokens: 0,
    ...overrides,
  };
}

function wireDb(byokRows: unknown[], userRows?: unknown[]) {
  let call = 0;
  (mockDbChain.select as ReturnType<typeof vi.fn>).mockImplementation(() => {
    const rows = call === 0 ? byokRows : (userRows ?? []);
    call++;
    return makeSelectChain(rows);
  });
}

/**
 * Full per-test mock isolation.
 *
 * Every `beforeEach` in this file MUST call this rather than clearing mocks.
 *
 * WHY: clearing only wipes recorded calls -- it does NOT drain the
 * `mock*Once()` queue. Any value queued by a test that never invokes the mock
 * stays armed on the module-scoped `deductTokens` stub and is handed to the
 * NEXT test that does invoke it, shifting every later result one test behind.
 * `resetAllMocks()` drains that queue.
 *
 * `resetAllMocks()` also drops implementations installed via chained
 * `mockReturnValue`/`mockResolvedValue`/`mockImplementation`, so the defaults
 * the module-scope `vi.mock` factories rely on are re-installed here
 * explicitly instead of depending on Vitest's `vi.fn(impl)` restore behaviour.
 */
function resetMocks() {
  vi.resetAllMocks();
  mockGetDb.mockImplementation(() => mockDbChain as unknown as ReturnType<typeof dbClient.getDb>);
  mockQueryWithResilience.mockImplementation((fn: () => unknown) => fn() as never);
  mockDecryptProviderKey.mockImplementation((encKey: string, _iv: string) => `decrypted:${encKey}`);
  // mockImplementation, not mockReturnValue: the module-scope factory returned a
  // FRESH object per call. Nothing depends on identity today, but a shared
  // object is a different contract, and this function is meant to RESTORE the
  // default rather than quietly redefine it.
  mockEncryptProviderKey.mockImplementation(() => ({ encrypted: 'enc-abc', iv: 'iv-abc' }));
}

// ---------------------------------------------------------------------------
// ApiKeyError
// ---------------------------------------------------------------------------

describe('ApiKeyError', () => {
  it('is an instance of Error', () => {
    const err = new ApiKeyError('NO_KEY_CONFIGURED', 'No key');
    expect(err).toBeInstanceOf(Error);
  });

  it('sets name to ApiKeyError', () => {
    const err = new ApiKeyError('TIER_NOT_ALLOWED', 'Tier error');
    expect(err.name).toBe('ApiKeyError');
  });

  it('exposes the error code', () => {
    const err = new ApiKeyError('INSUFFICIENT_TOKENS', 'Tokens error');
    expect(err.code).toBe('INSUFFICIENT_TOKENS');
  });

  it('exposes the message', () => {
    const err = new ApiKeyError('NO_KEY_CONFIGURED', 'Custom message');
    expect(err.message).toBe('Custom message');
  });
});

// ---------------------------------------------------------------------------
// resolveApiKey — BYOK path
// ---------------------------------------------------------------------------

describe('resolveApiKey - BYOK key', () => {
  beforeEach(() => {
    resetMocks();
    delete process.env['PLATFORM_MESHY_KEY'];
  });

  it('returns BYOK key when found', async () => {
    wireDb([makeBYOKKey()]);
    const result = await resolveApiKey('user-1', 'meshy', 50, 'texture_generation');
    expect(result.type).toBe('byok');
    expect(result.key).toBe('decrypted:encrypted-meshy-key');
    expect(result.metered).toBe(false);
  });

  it('does not deduct tokens for BYOK key', async () => {
    wireDb([makeBYOKKey()]);
    await resolveApiKey('user-1', 'meshy', 100, 'texture_generation');
    expect(mockDeductTokens).not.toHaveBeenCalled();
  });

  it('calls decryptProviderKey with encryptedKey and iv', async () => {
    wireDb([makeBYOKKey()]);
    await resolveApiKey('user-1', 'meshy', 50, 'texture_generation');
    expect(mockDecryptProviderKey).toHaveBeenCalledWith('encrypted-meshy-key', 'iv-xyz');
  });
});

// ---------------------------------------------------------------------------
// resolveApiKey — platform key path
// ---------------------------------------------------------------------------

describe('resolveApiKey - platform key', () => {
  beforeEach(() => {
    resetMocks();
    process.env['PLATFORM_MESHY_KEY'] = 'platform-meshy-secret';
  });

  afterEach(() => {
    delete process.env['PLATFORM_MESHY_KEY'];
  });

  it('throws TIER_NOT_ALLOWED for a starter account with nothing to spend', async () => {
    wireDb([], [makeUser({ tier: 'starter', monthlyTokens: 0, monthlyTokensUsed: 0, addonTokens: 0 })]);
    await expect(resolveApiKey('user-1', 'meshy', 50, 'texture_generation')).rejects.toThrow(ApiKeyError);
  });

  it('TIER_NOT_ALLOWED code is set on the starter tier error, including a spent trial', async () => {
    wireDb([], [makeUser({ tier: 'starter', monthlyTokens: 50, monthlyTokensUsed: 50, addonTokens: 0 })]);
    let caught: ApiKeyError | null = null;
    try {
      await resolveApiKey('user-1', 'meshy', 50, 'texture_generation');
    } catch (e) {
      caught = e as ApiKeyError;
    }
    expect(caught?.code).toBe('TIER_NOT_ALLOWED');
  });

  it('resolves the platform key and deducts for a starter account holding trial tokens (#7715)', async () => {
    wireDb([], [makeUser({ tier: 'starter', monthlyTokens: 50, monthlyTokensUsed: 0, addonTokens: 0 })]);
    mockDeductTokens.mockResolvedValueOnce({ success: true, remaining: { monthlyRemaining: 0, monthlyTotal: 50, addon: 0, total: 0, nextRefillDate: null }, usageId: 'u-trial' });
    const result = await resolveApiKey('user-1', 'meshy', 50, 'texture_generation');
    expect(result.type).toBe('platform');
    expect(result.usageId).toBe('u-trial');
    expect(mockDeductTokens).toHaveBeenCalledWith('user-1', 'texture_generation', 50, 'meshy', undefined);
  });

  it('throws NO_KEY_CONFIGURED for non-pro with zero balance', async () => {
    wireDb([], [makeUser({ tier: 'hobbyist', monthlyTokens: 100, monthlyTokensUsed: 100, addonTokens: 0 })]);
    let caught: ApiKeyError | null = null;
    try {
      await resolveApiKey('user-1', 'meshy', 50, 'texture_generation');
    } catch (e) {
      caught = e as ApiKeyError;
    }
    expect(caught?.code).toBe('NO_KEY_CONFIGURED');
  });

  it('proceeds for pro tier even with zero balance', async () => {
    wireDb([], [makeUser({ tier: 'pro', monthlyTokens: 0, monthlyTokensUsed: 0, addonTokens: 0 })]);
    mockDeductTokens.mockResolvedValueOnce({ success: true, remaining: { monthlyRemaining: 10, monthlyTotal: 0, addon: 0, total: 10, nextRefillDate: null }, usageId: 'u-1' });
    const result = await resolveApiKey('user-1', 'meshy', 50, 'texture_generation');
    expect(result.type).toBe('platform');
    expect(result.metered).toBe(true);
    expect(result.usageId).toBe('u-1');
  });

  it('deducts tokens and returns platform key', async () => {
    wireDb([], [makeUser({ tier: 'creator', monthlyTokens: 1000, monthlyTokensUsed: 0, addonTokens: 0 })]);
    mockDeductTokens.mockResolvedValueOnce({ success: true, remaining: { monthlyRemaining: 950, monthlyTotal: 1000, addon: 0, total: 950, nextRefillDate: null }, usageId: 'usage-abc' });
    const result = await resolveApiKey('user-1', 'meshy', 50, 'texture_generation');
    expect(result.type).toBe('platform');
    expect(result.key).toBe('platform-meshy-secret');
    expect(result.metered).toBe(true);
    expect(result.usageId).toBe('usage-abc');
    expect(mockDeductTokens).toHaveBeenCalledWith('user-1', 'texture_generation', 50, 'meshy', undefined);
  });

  it('throws INSUFFICIENT_TOKENS when deduction fails', async () => {
    wireDb([], [makeUser({ tier: 'creator', monthlyTokens: 1000, monthlyTokensUsed: 0, addonTokens: 0 })]);
    mockDeductTokens.mockResolvedValueOnce({ success: false, error: 'INSUFFICIENT_TOKENS', balance: { monthlyRemaining: 10, monthlyTotal: 100, addon: 0, total: 10, nextRefillDate: null }, cost: 50 });
    let caught: ApiKeyError | null = null;
    try {
      await resolveApiKey('user-1', 'meshy', 50, 'texture_generation');
    } catch (e) {
      caught = e as ApiKeyError;
    }
    expect(caught?.code).toBe('INSUFFICIENT_TOKENS');
  });

  it('throws when platform key env var is not set', async () => {
    delete process.env['PLATFORM_MESHY_KEY'];
    wireDb([], [makeUser({ tier: 'pro' })]);
    // No deductTokens result is queued on purpose: getPlatformKey() throws
    // before deductTokens is ever reached (#8597), so a queued value would sit
    // unconsumed and be handed to a later test. The sibling test below asserts
    // that ordering explicitly.
    await expect(resolveApiKey('user-1', 'meshy', 10, 'texture_generation')).rejects.toThrow('Platform key not configured');
  });

  it('does NOT deduct tokens when the platform key is missing (#8597)', async () => {
    // Regression: previously deductTokens ran BEFORE getPlatformKey, so a
    // missing platform key (server misconfig) charged the user and then threw
    // with no refund — silent paid-token loss. The key must be resolved before
    // any deduction so a missing key costs nothing.
    delete process.env['PLATFORM_MESHY_KEY'];
    wireDb([], [makeUser({ tier: 'pro' })]);
    mockDeductTokens.mockResolvedValue({ success: true, remaining: { monthlyRemaining: 50, monthlyTotal: 3000, addon: 0, total: 50, nextRefillDate: null }, usageId: 'u-leak' });
    await expect(resolveApiKey('user-1', 'meshy', 10, 'texture_generation')).rejects.toThrow('Platform key not configured');
    expect(mockDeductTokens).not.toHaveBeenCalled();
  });

  it('throws when user is not found in DB', async () => {
    wireDb([], []); // no user returned
    await expect(resolveApiKey('user-1', 'meshy', 50, 'texture_generation')).rejects.toThrow('User not found');
  });

  it('passes metadata to deductTokens', async () => {
    wireDb([], [makeUser({ tier: 'pro' })]);
    mockDeductTokens.mockResolvedValueOnce({ success: true, remaining: { monthlyRemaining: 100, monthlyTotal: 3000, addon: 0, total: 100, nextRefillDate: null }, usageId: 'u-3' });
    process.env['PLATFORM_MESHY_KEY'] = 'key';
    const meta = { quality: 'high', width: 1024 };
    const result = await resolveApiKey('user-1', 'meshy', 50, 'texture_generation', meta);
    expect(mockDeductTokens).toHaveBeenCalledWith('user-1', 'texture_generation', 50, 'meshy', meta);
    expect(result.usageId).toBe('u-3');
  });

  it('counts addonTokens in available balance', async () => {
    wireDb([], [makeUser({ tier: 'hobbyist', monthlyTokens: 100, monthlyTokensUsed: 100, addonTokens: 200 })]);
    mockDeductTokens.mockResolvedValueOnce({ success: true, remaining: { monthlyRemaining: 0, monthlyTotal: 100, addon: 200, total: 200, nextRefillDate: null }, usageId: 'u-4' });
    const result = await resolveApiKey('user-1', 'meshy', 50, 'texture_generation');
    expect(result.type).toBe('platform');
    expect(result.usageId).toBe('u-4');
  });
});

// ---------------------------------------------------------------------------
// resolveApiKey — status poll of an already-paid job (#7715)
// ---------------------------------------------------------------------------

describe('resolveApiKey - status poll (tokenCost 0 AND STATUS_CHECK_OPERATION, #7715)', () => {
  const SPENT_STARTER = { tier: 'starter', monthlyTokens: 50, monthlyTokensUsed: 50, addonTokens: 0 };
  const HOBBYIST_AT_ZERO = { tier: 'hobbyist', monthlyTokens: 100, monthlyTokensUsed: 100, addonTokens: 0 };

  async function codeOf(p: Promise<unknown>): Promise<string | undefined> {
    try {
      await p;
    } catch (e) {
      return (e as ApiKeyError).code;
    }
    return undefined;
  }

  beforeEach(() => {
    resetMocks();
    process.env['PLATFORM_MESHY_KEY'] = 'platform-meshy-secret';
  });

  afterEach(() => {
    delete process.env['PLATFORM_MESHY_KEY'];
  });

  it('resolves the platform key for a starter whose trial grant is spent, with no deduction and no usage record', async () => {
    wireDb([], [makeUser(SPENT_STARTER)]);
    const result = await resolveApiKey('user-1', 'meshy', 0, STATUS_CHECK_OPERATION);
    expect(result).toEqual({ type: 'platform', key: 'platform-meshy-secret', metered: true });
    expect(result.usageId).toBeUndefined();
    expect(mockDeductTokens).not.toHaveBeenCalled();
  });

  it('resolves the platform key for a hobbyist at exactly 0 (the lockout that predates the trial)', async () => {
    wireDb([], [makeUser(HOBBYIST_AT_ZERO)]);
    const result = await resolveApiKey('user-1', 'meshy', 0, STATUS_CHECK_OPERATION);
    expect(result.type).toBe('platform');
    expect(result.key).toBe('platform-meshy-secret');
    expect(mockDeductTokens).not.toHaveBeenCalled();
  });

  it('still prefers a BYOK key over the platform key', async () => {
    wireDb([makeBYOKKey()], [makeUser(SPENT_STARTER)]);
    const result = await resolveApiKey('user-1', 'meshy', 0, STATUS_CHECK_OPERATION);
    expect(result).toEqual({ type: 'byok', key: 'decrypted:encrypted-meshy-key', metered: false });
    expect(mockDeductTokens).not.toHaveBeenCalled();
  });

  it('still throws when the platform key is not configured, without deducting', async () => {
    delete process.env['PLATFORM_MESHY_KEY'];
    wireDb([], [makeUser(SPENT_STARTER)]);
    await expect(resolveApiKey('user-1', 'meshy', 0, STATUS_CHECK_OPERATION)).rejects.toThrow('Platform key not configured');
    expect(mockDeductTokens).not.toHaveBeenCalled();
  });

  // Each half of the condition is required. These two cases are what make
  // `tokenCost === 0` and `operation === STATUS_CHECK_OPERATION` each
  // load-bearing: dropping either half from the resolver turns one of them red.
  it('enforces BOTH checks for STATUS_CHECK_OPERATION with a non-zero cost', async () => {
    wireDb([], [makeUser(SPENT_STARTER)]);
    expect(await codeOf(resolveApiKey('user-1', 'meshy', 10, STATUS_CHECK_OPERATION))).toBe('TIER_NOT_ALLOWED');
    wireDb([], [makeUser(HOBBYIST_AT_ZERO)]);
    expect(await codeOf(resolveApiKey('user-1', 'meshy', 10, STATUS_CHECK_OPERATION))).toBe('NO_KEY_CONFIGURED');
    expect(mockDeductTokens).not.toHaveBeenCalled();
  });

  it('enforces BOTH checks for a zero-cost call under any other operation', async () => {
    wireDb([], [makeUser(SPENT_STARTER)]);
    expect(await codeOf(resolveApiKey('user-1', 'meshy', 0, 'texture_generation'))).toBe('TIER_NOT_ALLOWED');
    wireDb([], [makeUser(HOBBYIST_AT_ZERO)]);
    expect(await codeOf(resolveApiKey('user-1', 'meshy', 0, 'texture_generation'))).toBe('NO_KEY_CONFIGURED');
    expect(mockDeductTokens).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// resolveApiKey — gateway-routed capability (#9523)
// ---------------------------------------------------------------------------

describe('resolveApiKey - gateway-routed capability (#9523)', () => {
  const remaining = { monthlyRemaining: 50, monthlyTotal: 3000, addon: 0, total: 50, nextRefillDate: null };

  beforeEach(() => {
    resetMocks();
    vi.stubEnv('VERCEL', '');
    vi.stubEnv('VERCEL_ENV', '');
    vi.stubEnv('PLATFORM_REPLICATE_KEY', '');
    vi.stubEnv('PLATFORM_OPENAI_KEY', '');
    vi.stubEnv('AI_GATEWAY_API_KEY', 'gw-secret');
  });

  afterEach(() => vi.unstubAllEnvs());

  it.each(['image', 'embedding'] as const)(
    'resolves AI_GATEWAY_API_KEY for %s with no PLATFORM_OPENAI_KEY set',
    async (capability) => {
      wireDb([], [makeUser({ tier: 'pro' })]);
      mockDeductTokens.mockResolvedValueOnce({ success: true, remaining, usageId: 'u-gw' });
      const result = await resolveApiKey('user-1', 'openai', 20, `${capability}_generation`, undefined, capability);
      expect(result.type).toBe('platform');
      expect(result.key).toBe('gw-secret');
      expect(result.metered).toBe(true);
      expect(result.usageId).toBe('u-gw');
    },
  );

  it('does NOT throw "Platform key not configured" for a gateway capability when its old PLATFORM_* var is absent', async () => {
    wireDb([], [makeUser({ tier: 'pro' })]);
    mockDeductTokens.mockResolvedValueOnce({ success: true, remaining, usageId: 'u-gw2' });
    await expect(
      resolveApiKey('user-1', 'openai', 20, 'image_generation', undefined, 'image'),
    ).resolves.toMatchObject({ type: 'platform', key: 'gw-secret' });
  });

  it('deducts tokens against the capability provider, identically to the direct path', async () => {
    wireDb([], [makeUser({ tier: 'pro' })]);
    mockDeductTokens.mockResolvedValueOnce({ success: true, remaining, usageId: 'u-gw3' });
    const meta = { size: '1024x1024' };
    await resolveApiKey('user-1', 'openai', 20, 'image_generation', meta, 'image');
    // Accounting is keyed on the capability's provider, not the gateway — the
    // circuit breaker and usage ledger behave identically to the direct route.
    expect(mockDeductTokens).toHaveBeenCalledWith('user-1', 'image_generation', 20, 'openai', meta);
  });

  it('throws, and never falls back to PLATFORM_OPENAI_KEY, when AI_GATEWAY_API_KEY is absent', async () => {
    vi.stubEnv('AI_GATEWAY_API_KEY', '');
    vi.stubEnv('PLATFORM_OPENAI_KEY', 'sk-openai-direct');
    wireDb([], [makeUser({ tier: 'pro' })]);
    mockDeductTokens.mockResolvedValue({ success: true, remaining, usageId: 'u-leak' });
    await expect(
      resolveApiKey('user-1', 'openai', 20, 'image_generation', undefined, 'image'),
    ).rejects.toThrow('Platform key not configured: AI_GATEWAY_API_KEY');
    // Key resolves before any deduction (#8597): a missing gateway key costs nothing.
    expect(mockDeductTokens).not.toHaveBeenCalled();
  });

  it('lets a user BYOK key take precedence over gateway routing', async () => {
    wireDb([{ userId: 'user-1', provider: 'openai', encryptedKey: 'enc-openai', iv: 'iv-o' }]);
    const result = await resolveApiKey('user-1', 'openai', 20, 'image_generation', undefined, 'image');
    expect(result.type).toBe('byok');
    expect(result.key).toBe('decrypted:enc-openai');
    expect(mockDeductTokens).not.toHaveBeenCalled();
  });

  it('leaves a non-gateway capability (sprite → replicate) requiring its PLATFORM_* var, unaffected by the gateway key', async () => {
    // AI_GATEWAY_API_KEY is set by beforeEach, but sprite is direct-routed.
    wireDb([], [makeUser({ tier: 'pro' })]);
    mockDeductTokens.mockResolvedValue({ success: true, remaining, usageId: 'u-sprite' });
    await expect(
      resolveApiKey('user-1', 'replicate', 10, 'sprite_generation', undefined, 'sprite'),
    ).rejects.toThrow('Platform key not configured: PLATFORM_REPLICATE_KEY');
    expect(mockDeductTokens).not.toHaveBeenCalled();
  });

  it('leaves the direct path unchanged when no capability is supplied', async () => {
    // The existing 5-arg call shape (chat/decompose/status routes) never routes
    // to the gateway: with no PLATFORM_OPENAI_KEY it throws the OpenAI-key error.
    wireDb([], [makeUser({ tier: 'pro' })]);
    await expect(
      resolveApiKey('user-1', 'openai', 20, 'image_generation'),
    ).rejects.toThrow('Platform key not configured: PLATFORM_OPENAI_KEY');
  });
});

// ---------------------------------------------------------------------------
// resolveApiKey — chat is NOT forced onto the gateway, + OIDC (#10074)
// ---------------------------------------------------------------------------

describe('resolveApiKey - chat fallback and Vercel OIDC (#10074)', () => {
  const remaining = { monthlyRemaining: 50, monthlyTotal: 3000, addon: 0, total: 50, nextRefillDate: null };

  beforeEach(() => {
    resetMocks();
    vi.stubEnv('AI_GATEWAY_API_KEY', '');
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    vi.stubEnv('VERCEL', '');
    vi.stubEnv('VERCEL_ENV', '');
  });

  afterEach(() => vi.unstubAllEnvs());

  it('resolves ANTHROPIC_API_KEY for the chat capability when AI_GATEWAY_API_KEY is unset', async () => {
    // The critical regression (#10074): forwarding capability 'chat' to the
    // resolver must NOT re-key localize/pacing onto the gateway. A
    // direct-Anthropic deployment (`.env.example`) has ANTHROPIC_API_KEY set and
    // no gateway key, and both routes must keep working.
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-platform');
    wireDb([], [makeUser({ tier: 'pro' })]);
    mockDeductTokens.mockResolvedValueOnce({ success: true, remaining, usageId: 'u-chat' });
    const result = await resolveApiKey('user-1', 'anthropic', 10, 'localize_scene', undefined, 'chat');
    expect(result.type).toBe('platform');
    expect(result.key).toBe('sk-ant-platform');
  });

  it('does not consult AI_GATEWAY_API_KEY for the chat capability even when it is set', async () => {
    // chat is gateway-SERVED (via /api/chat) but not gateway-ONLY: the resolver
    // path for localize/pacing resolves the provider's own Anthropic key.
    vi.stubEnv('AI_GATEWAY_API_KEY', 'gw-secret');
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-platform');
    wireDb([], [makeUser({ tier: 'pro' })]);
    mockDeductTokens.mockResolvedValueOnce({ success: true, remaining, usageId: 'u-chat2' });
    const result = await resolveApiKey('user-1', 'anthropic', 10, 'pacing_suggestions', undefined, 'chat');
    expect(result.key).toBe('sk-ant-platform');
  });

  it.each(['image', 'embedding'] as const)(
    'accepts Vercel OIDC for %s: returns the empty key instead of throwing when AI_GATEWAY_API_KEY is unset on Vercel',
    async (capability) => {
      // vercelGatewayBackend.isConfigured() is true on OIDC alone; the resolver
      // must mirror it or the PR's one-credential goal is unreachable on an
      // OIDC-only deployment (#10074).
      vi.stubEnv('VERCEL_ENV', 'production');
      wireDb([], [makeUser({ tier: 'pro' })]);
      mockDeductTokens.mockResolvedValueOnce({ success: true, remaining, usageId: 'u-oidc' });
      const result = await resolveApiKey('user-1', 'openai', 20, `${capability}_generation`, undefined, capability);
      expect(result.type).toBe('platform');
      expect(result.key).toBe('');
      expect(result.metered).toBe(true);
    },
  );

  it('still throws off-Vercel for a resolver-gateway capability with no gateway key', async () => {
    // No VERCEL/VERCEL_ENV: OIDC is unavailable, so the missing gateway key is a
    // real misconfiguration and must fail before any token deduction.
    wireDb([], [makeUser({ tier: 'pro' })]);
    mockDeductTokens.mockResolvedValue({ success: true, remaining, usageId: 'u-x' });
    await expect(
      resolveApiKey('user-1', 'openai', 20, 'image_generation', undefined, 'image'),
    ).rejects.toThrow('Platform key not configured: AI_GATEWAY_API_KEY');
    expect(mockDeductTokens).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// storeProviderKey
// ---------------------------------------------------------------------------

describe('storeProviderKey', () => {
  beforeEach(() => {
    resetMocks();
    (mockDbChain.insert as ReturnType<typeof vi.fn>).mockImplementation(() => makeInsertChain());
  });

  it('inserts encrypted key with upsert', async () => {
    mockEncryptProviderKey.mockReturnValueOnce({ encrypted: 'enc-key', iv: 'iv-val' });
    await storeProviderKey('user-1', 'anthropic', 'sk-plain-key');
    expect(mockDbChain.insert).toHaveBeenCalled();
    const insertChain = (mockDbChain.insert as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(insertChain.values).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      provider: 'anthropic',
      encryptedKey: 'enc-key',
      iv: 'iv-val',
    }));
    expect(insertChain.onConflictDoUpdate).toHaveBeenCalled();
  });

  it('uses the plain key as input for encryption', async () => {
    mockEncryptProviderKey.mockReturnValueOnce({ encrypted: 'enc-2', iv: 'iv-2' });
    await storeProviderKey('user-1', 'elevenlabs', 'my-plaintext-key');
    expect(mockEncryptProviderKey).toHaveBeenCalledWith('my-plaintext-key');
  });
});

// ---------------------------------------------------------------------------
// deleteProviderKey
// ---------------------------------------------------------------------------

describe('deleteProviderKey', () => {
  beforeEach(() => {
    resetMocks();
    (mockDbChain.delete as ReturnType<typeof vi.fn>).mockImplementation(() => makeDeleteChain());
  });

  it('deletes the provider key', async () => {
    await deleteProviderKey('user-1', 'meshy');
    expect(mockDbChain.delete).toHaveBeenCalled();
    const deleteChain = (mockDbChain.delete as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(deleteChain.where).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// listConfiguredProviders
// ---------------------------------------------------------------------------

describe('listConfiguredProviders', () => {
  beforeEach(() => resetMocks());

  it('returns list of providers', async () => {
    const keys = [
      { provider: 'meshy', createdAt: new Date('2026-01-01') },
      { provider: 'anthropic', createdAt: new Date('2026-01-02') },
    ];
    const selectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue(keys),
    };
    (mockDbChain.select as ReturnType<typeof vi.fn>).mockReturnValueOnce(selectChain);
    const result = await listConfiguredProviders('user-1');
    expect(result).toEqual(keys);
  });

  it('returns empty array when no keys configured', async () => {
    const selectChain = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]),
    };
    (mockDbChain.select as ReturnType<typeof vi.fn>).mockReturnValueOnce(selectChain);
    const result = await listConfiguredProviders('user-1');
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// resolveByokOrPlatformKey (#9734) — non-charging secondary-provider resolution
// ---------------------------------------------------------------------------

describe('resolveByokOrPlatformKey', () => {
  beforeEach(() => {
    resetMocks();
    vi.stubEnv('PLATFORM_REMOVEBG_KEY', undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns the decrypted BYOK key first and never deducts tokens', async () => {
    wireDb([{ userId: 'user-1', provider: 'removebg', encryptedKey: 'enc-removebg', iv: 'iv-1' }]);
    vi.stubEnv('PLATFORM_REMOVEBG_KEY', 'platform-removebg-secret');

    const key = await resolveByokOrPlatformKey('user-1', 'removebg');

    expect(key).toBe('decrypted:enc-removebg');
    expect(mockDeductTokens).not.toHaveBeenCalled();
  });

  it('falls back to PLATFORM_REMOVEBG_KEY when no BYOK key exists', async () => {
    wireDb([]);
    vi.stubEnv('PLATFORM_REMOVEBG_KEY', 'platform-removebg-secret');

    const key = await resolveByokOrPlatformKey('user-1', 'removebg');

    expect(key).toBe('platform-removebg-secret');
    expect(mockDeductTokens).not.toHaveBeenCalled();
  });

  it('returns null when neither a BYOK key nor PLATFORM_REMOVEBG_KEY is set', async () => {
    wireDb([]);

    const key = await resolveByokOrPlatformKey('user-1', 'removebg');

    expect(key).toBeNull();
    expect(mockDeductTokens).not.toHaveBeenCalled();
  });
});
