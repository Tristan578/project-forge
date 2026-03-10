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

import { resolveApiKey, storeProviderKey, deleteProviderKey, listConfiguredProviders, ApiKeyError } from '@/lib/keys/resolver';
import * as encryption from '@/lib/keys/encryption';
import * as tokenService from '@/lib/tokens/service';

const mockDeductTokens = vi.mocked(tokenService.deductTokens);
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
    vi.clearAllMocks();
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
    vi.clearAllMocks();
    process.env['PLATFORM_MESHY_KEY'] = 'platform-meshy-secret';
  });

  afterEach(() => {
    delete process.env['PLATFORM_MESHY_KEY'];
  });

  it('throws TIER_NOT_ALLOWED for starter tier', async () => {
    wireDb([], [makeUser({ tier: 'starter' })]);
    await expect(resolveApiKey('user-1', 'meshy', 50, 'texture_generation')).rejects.toThrow(ApiKeyError);
  });

  it('TIER_NOT_ALLOWED code is set on starter tier error', async () => {
    wireDb([], [makeUser({ tier: 'starter' })]);
    let caught: ApiKeyError | null = null;
    try {
      await resolveApiKey('user-1', 'meshy', 50, 'texture_generation');
    } catch (e) {
      caught = e as ApiKeyError;
    }
    expect(caught?.code).toBe('TIER_NOT_ALLOWED');
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
    mockDeductTokens.mockResolvedValueOnce({ success: true, balance: { total: 10 }, usageId: 'u-1' });
    const result = await resolveApiKey('user-1', 'meshy', 50, 'texture_generation');
    expect(result.type).toBe('platform');
    expect(result.metered).toBe(true);
  });

  it('deducts tokens and returns platform key', async () => {
    wireDb([], [makeUser({ tier: 'creator', monthlyTokens: 1000, monthlyTokensUsed: 0, addonTokens: 0 })]);
    mockDeductTokens.mockResolvedValueOnce({ success: true, balance: { total: 950 }, usageId: 'usage-abc' });
    const result = await resolveApiKey('user-1', 'meshy', 50, 'texture_generation');
    expect(result.type).toBe('platform');
    expect(result.key).toBe('platform-meshy-secret');
    expect(result.metered).toBe(true);
    expect(result.usageId).toBe('usage-abc');
    expect(mockDeductTokens).toHaveBeenCalledWith('user-1', 'texture_generation', 50, 'meshy', undefined);
  });

  it('throws INSUFFICIENT_TOKENS when deduction fails', async () => {
    wireDb([], [makeUser({ tier: 'creator', monthlyTokens: 1000, monthlyTokensUsed: 0, addonTokens: 0 })]);
    mockDeductTokens.mockResolvedValueOnce({ success: false, balance: { total: 10 } });
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
    mockDeductTokens.mockResolvedValueOnce({ success: true, balance: { total: 50 }, usageId: 'u-2' });
    await expect(resolveApiKey('user-1', 'meshy', 10, 'texture_generation')).rejects.toThrow('Platform key not configured');
  });

  it('throws when user is not found in DB', async () => {
    wireDb([], []); // no user returned
    await expect(resolveApiKey('user-1', 'meshy', 50, 'texture_generation')).rejects.toThrow('User not found');
  });

  it('passes metadata to deductTokens', async () => {
    wireDb([], [makeUser({ tier: 'pro' })]);
    mockDeductTokens.mockResolvedValueOnce({ success: true, balance: { total: 100 }, usageId: 'u-3' });
    process.env['PLATFORM_MESHY_KEY'] = 'key';
    const meta = { quality: 'high', width: 1024 };
    await resolveApiKey('user-1', 'meshy', 50, 'texture_generation', meta);
    expect(mockDeductTokens).toHaveBeenCalledWith('user-1', 'texture_generation', 50, 'meshy', meta);
  });

  it('counts addonTokens in available balance', async () => {
    wireDb([], [makeUser({ tier: 'hobbyist', monthlyTokens: 100, monthlyTokensUsed: 100, addonTokens: 200 })]);
    mockDeductTokens.mockResolvedValueOnce({ success: true, balance: { total: 200 }, usageId: 'u-4' });
    const result = await resolveApiKey('user-1', 'meshy', 50, 'texture_generation');
    expect(result.type).toBe('platform');
  });
});

// ---------------------------------------------------------------------------
// storeProviderKey
// ---------------------------------------------------------------------------

describe('storeProviderKey', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    vi.clearAllMocks();
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
  beforeEach(() => vi.clearAllMocks());

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
