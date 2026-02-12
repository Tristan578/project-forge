import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomBytes } from 'crypto';

// Generate a valid test key before importing the module
const TEST_MASTER_KEY = randomBytes(32).toString('hex');

describe('encryption', () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.ENCRYPTION_MASTER_KEY;
    process.env.ENCRYPTION_MASTER_KEY = TEST_MASTER_KEY;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.ENCRYPTION_MASTER_KEY = originalEnv;
    } else {
      delete process.env.ENCRYPTION_MASTER_KEY;
    }
  });

  it('encrypts and decrypts a key correctly', async () => {
    const { encryptProviderKey, decryptProviderKey } = await import('./encryption');
    const plainKey = 'sk-test-1234567890abcdef';

    const { encrypted, iv } = encryptProviderKey(plainKey);
    const decrypted = decryptProviderKey(encrypted, iv);

    expect(decrypted).toBe(plainKey);
  });

  it('produces different ciphertext for same plaintext (random IV)', async () => {
    const { encryptProviderKey } = await import('./encryption');
    const plainKey = 'sk-same-key-both-times';

    const result1 = encryptProviderKey(plainKey);
    const result2 = encryptProviderKey(plainKey);

    expect(result1.encrypted).not.toBe(result2.encrypted);
    expect(result1.iv).not.toBe(result2.iv);
  });

  it('fails to decrypt with wrong IV', async () => {
    const { encryptProviderKey, decryptProviderKey } = await import('./encryption');
    const plainKey = 'sk-test-wrong-iv';

    const { encrypted } = encryptProviderKey(plainKey);
    const wrongIv = randomBytes(16).toString('base64');

    expect(() => decryptProviderKey(encrypted, wrongIv)).toThrow();
  });

  it('throws when ENCRYPTION_MASTER_KEY is missing', async () => {
    delete process.env.ENCRYPTION_MASTER_KEY;

    // Need to re-import to avoid module cache
    const { encryptProviderKey } = await import('./encryption');
    expect(() => encryptProviderKey('test')).toThrow('ENCRYPTION_MASTER_KEY');
  });

  it('throws when ENCRYPTION_MASTER_KEY is wrong length', async () => {
    process.env.ENCRYPTION_MASTER_KEY = 'tooshort';

    const { encryptProviderKey } = await import('./encryption');
    expect(() => encryptProviderKey('test')).toThrow('64-character hex string');
  });

  it('handles empty string', async () => {
    const { encryptProviderKey, decryptProviderKey } = await import('./encryption');

    const { encrypted, iv } = encryptProviderKey('');
    const decrypted = decryptProviderKey(encrypted, iv);

    expect(decrypted).toBe('');
  });

  it('handles unicode characters', async () => {
    const { encryptProviderKey, decryptProviderKey } = await import('./encryption');
    const unicodeKey = 'sk-test-🔑-日本語-مفتاح';

    const { encrypted, iv } = encryptProviderKey(unicodeKey);
    const decrypted = decryptProviderKey(encrypted, iv);

    expect(decrypted).toBe(unicodeKey);
  });
});
