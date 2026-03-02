/**
 * Comprehensive tests for AES-256-GCM BYOK encryption.
 *
 * Security invariants verified:
 *  - Round-trip correctness (encrypt then decrypt recovers plaintext)
 *  - IV randomness (same plaintext produces different ciphertext)
 *  - Auth-tag integrity (tampered ciphertext fails decryption)
 *  - Wrong IV fails decryption
 *  - Missing / malformed master key throws at usage time
 *  - Output format is base64-encoded (no raw bytes leaked as strings)
 *  - Edge inputs: empty string, very long string, binary-safe unicode, newlines
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomBytes } from 'crypto';

// ----- helpers -----

/** Generate a fresh 64-char hex key (32 bytes). */
function freshKey(): string {
  return randomBytes(32).toString('hex');
}

/** Corrupt a base64 string at the given byte offset. */
function corruptBase64(b64: string, byteOffset: number): string {
  const buf = Buffer.from(b64, 'base64');
  buf[byteOffset] = (buf[byteOffset] + 1) & 0xff;
  return buf.toString('base64');
}

// ----- fixture -----

const TEST_MASTER_KEY = freshKey();

describe('encryption module', () => {
  let savedEnv: string | undefined;

  beforeEach(() => {
    savedEnv = process.env.ENCRYPTION_MASTER_KEY;
    process.env.ENCRYPTION_MASTER_KEY = TEST_MASTER_KEY;
  });

  afterEach(() => {
    if (savedEnv !== undefined) {
      process.env.ENCRYPTION_MASTER_KEY = savedEnv;
    } else {
      delete process.env.ENCRYPTION_MASTER_KEY;
    }
    // Env var is restored above; module cache is shared across tests in the
    // same file, which is fine because all tests in this suite use the same key.
  });

  // ================================================================
  // 1. Round-trip correctness
  // ================================================================

  describe('round-trip correctness', () => {
    it('decrypts an encrypted key back to the original plaintext', async () => {
      const { encryptProviderKey, decryptProviderKey } = await import('../encryption');
      const plain = 'sk-proj-abc123XYZ';

      const { encrypted, iv } = encryptProviderKey(plain);
      expect(decryptProviderKey(encrypted, iv)).toBe(plain);
    });

    it('handles an empty string', async () => {
      const { encryptProviderKey, decryptProviderKey } = await import('../encryption');
      const { encrypted, iv } = encryptProviderKey('');
      expect(decryptProviderKey(encrypted, iv)).toBe('');
    });

    it('handles a very long key string (2 048 chars)', async () => {
      const { encryptProviderKey, decryptProviderKey } = await import('../encryption');
      const long = 'x'.repeat(2048);
      const { encrypted, iv } = encryptProviderKey(long);
      expect(decryptProviderKey(encrypted, iv)).toBe(long);
    });

    it('handles unicode characters including emoji and CJK', async () => {
      const { encryptProviderKey, decryptProviderKey } = await import('../encryption');
      const unicode = 'sk-test-\uD83D\uDD11-\u65E5\u672C\u8A9E-\u0645\u0641\u062A\u0627\u062D';
      const { encrypted, iv } = encryptProviderKey(unicode);
      expect(decryptProviderKey(encrypted, iv)).toBe(unicode);
    });

    it('handles a string containing newlines and null bytes', async () => {
      const { encryptProviderKey, decryptProviderKey } = await import('../encryption');
      const tricky = 'line1\nline2\r\nline3\x00end';
      const { encrypted, iv } = encryptProviderKey(tricky);
      expect(decryptProviderKey(encrypted, iv)).toBe(tricky);
    });

    it('handles a key that looks like base64 itself', async () => {
      const { encryptProviderKey, decryptProviderKey } = await import('../encryption');
      const b64like = randomBytes(48).toString('base64');
      const { encrypted, iv } = encryptProviderKey(b64like);
      expect(decryptProviderKey(encrypted, iv)).toBe(b64like);
    });
  });

  // ================================================================
  // 2. IV randomness — probabilistic guarantee
  // ================================================================

  describe('IV randomness', () => {
    it('produces a different encrypted blob for the same plaintext on each call', async () => {
      const { encryptProviderKey } = await import('../encryption');
      const plain = 'same-key-every-time';

      const r1 = encryptProviderKey(plain);
      const r2 = encryptProviderKey(plain);
      const r3 = encryptProviderKey(plain);

      expect(r1.encrypted).not.toBe(r2.encrypted);
      expect(r1.encrypted).not.toBe(r3.encrypted);
      expect(r2.encrypted).not.toBe(r3.encrypted);
    });

    it('produces a different IV on each call', async () => {
      const { encryptProviderKey } = await import('../encryption');
      const r1 = encryptProviderKey('test');
      const r2 = encryptProviderKey('test');
      expect(r1.iv).not.toBe(r2.iv);
    });

    it('returns iv as a valid base64 string', async () => {
      const { encryptProviderKey } = await import('../encryption');
      const { iv } = encryptProviderKey('anything');
      // Must round-trip through base64 without loss
      expect(Buffer.from(iv, 'base64').toString('base64')).toBe(iv);
    });

    it('IV decodes to exactly 16 bytes (IV_LENGTH constant)', async () => {
      const { encryptProviderKey } = await import('../encryption');
      const { iv } = encryptProviderKey('check iv length');
      expect(Buffer.from(iv, 'base64').byteLength).toBe(16);
    });
  });

  // ================================================================
  // 3. Integrity / auth-tag protection
  // ================================================================

  describe('auth-tag integrity', () => {
    it('throws when the last byte of the ciphertext blob is corrupted (auth-tag damage)', async () => {
      const { encryptProviderKey, decryptProviderKey } = await import('../encryption');
      const { encrypted, iv } = encryptProviderKey('authentic');
      const buf = Buffer.from(encrypted, 'base64');
      // Corrupt the very last byte (part of the 16-byte auth tag appended at end)
      buf[buf.length - 1] ^= 0xff;
      const tampered = buf.toString('base64');
      expect(() => decryptProviderKey(tampered, iv)).toThrow();
    });

    it('throws when a byte inside the ciphertext body is flipped', async () => {
      const { encryptProviderKey, decryptProviderKey } = await import('../encryption');
      // Use a plaintext long enough that byte 0 is ciphertext, not the tag
      const { encrypted, iv } = encryptProviderKey('a'.repeat(64));
      const tampered = corruptBase64(encrypted, 0);
      expect(() => decryptProviderKey(tampered, iv)).toThrow();
    });

    it('throws when the encrypted blob is truncated (missing auth-tag bytes)', async () => {
      const { encryptProviderKey, decryptProviderKey } = await import('../encryption');
      const { encrypted, iv } = encryptProviderKey('truncation test');
      const buf = Buffer.from(encrypted, 'base64');
      // Remove last 8 bytes (partial tag)
      const truncated = buf.subarray(0, buf.length - 8).toString('base64');
      expect(() => decryptProviderKey(truncated, iv)).toThrow();
    });

    it('throws when using a completely wrong IV', async () => {
      const { encryptProviderKey, decryptProviderKey } = await import('../encryption');
      const { encrypted } = encryptProviderKey('wrong iv test');
      const wrongIv = randomBytes(16).toString('base64');
      expect(() => decryptProviderKey(encrypted, wrongIv)).toThrow();
    });

    it('throws when swapping IV and encrypted values', async () => {
      const { encryptProviderKey, decryptProviderKey } = await import('../encryption');
      const { encrypted, iv } = encryptProviderKey('swap test');
      // Pass iv where encrypted is expected and vice-versa
      expect(() => decryptProviderKey(iv, encrypted)).toThrow();
    });

    it('two independently encrypted copies of the same plaintext cannot cross-decrypt', async () => {
      const { encryptProviderKey, decryptProviderKey } = await import('../encryption');
      const r1 = encryptProviderKey('cross-decrypt-test');
      const r2 = encryptProviderKey('cross-decrypt-test');
      // Using r1's encrypted payload with r2's iv must fail
      expect(() => decryptProviderKey(r1.encrypted, r2.iv)).toThrow();
    });
  });

  // ================================================================
  // 4. Master-key validation
  // ================================================================

  describe('master key validation', () => {
    it('throws with descriptive message when ENCRYPTION_MASTER_KEY is absent', async () => {
      delete process.env.ENCRYPTION_MASTER_KEY;
      const { encryptProviderKey } = await import('../encryption');
      expect(() => encryptProviderKey('test')).toThrow('ENCRYPTION_MASTER_KEY');
    });

    it('throws when key is shorter than 64 hex chars', async () => {
      process.env.ENCRYPTION_MASTER_KEY = 'deadbeef'; // 8 chars
      const { encryptProviderKey } = await import('../encryption');
      expect(() => encryptProviderKey('test')).toThrow();
    });

    it('throws when key is exactly 63 chars (one short)', async () => {
      process.env.ENCRYPTION_MASTER_KEY = 'a'.repeat(63);
      const { encryptProviderKey } = await import('../encryption');
      expect(() => encryptProviderKey('test')).toThrow('64-character hex string');
    });

    it('throws when key is 65 chars (one over)', async () => {
      process.env.ENCRYPTION_MASTER_KEY = 'a'.repeat(65);
      const { encryptProviderKey } = await import('../encryption');
      expect(() => encryptProviderKey('test')).toThrow('64-character hex string');
    });

    it('throws when key is the right length but contains non-hex chars', async () => {
      // 64 chars but includes 'z' which is not a valid hex digit.
      // Node's Buffer.from('zzz...', 'hex') returns a zero-length buffer
      // (it stops at the first invalid nibble), so AES-256-GCM rejects it
      // immediately with "Invalid key length".
      process.env.ENCRYPTION_MASTER_KEY = 'z'.repeat(64);
      const { encryptProviderKey } = await import('../encryption');
      expect(() => encryptProviderKey('hex-chars-test')).toThrow();
    });

    it('throws on decryptProviderKey when master key is missing', async () => {
      const { encryptProviderKey, decryptProviderKey } = await import('../encryption');
      const { encrypted, iv } = encryptProviderKey('capture this');
      delete process.env.ENCRYPTION_MASTER_KEY;
      expect(() => decryptProviderKey(encrypted, iv)).toThrow('ENCRYPTION_MASTER_KEY');
    });

    it('error message includes generation hint', async () => {
      delete process.env.ENCRYPTION_MASTER_KEY;
      const { encryptProviderKey } = await import('../encryption');
      let msg = '';
      try {
        encryptProviderKey('x');
      } catch (e) {
        msg = e instanceof Error ? e.message : '';
      }
      expect(msg).toContain('Generate with');
    });
  });

  // ================================================================
  // 5. Output format guarantees
  // ================================================================

  describe('output format', () => {
    it('encrypted field is a valid base64 string', async () => {
      const { encryptProviderKey } = await import('../encryption');
      const { encrypted } = encryptProviderKey('format test');
      expect(() => Buffer.from(encrypted, 'base64')).not.toThrow();
      // Re-encoding should be identical (no stray padding issues)
      expect(Buffer.from(encrypted, 'base64').toString('base64')).toBe(encrypted);
    });

    it('encrypted blob is larger than the plaintext (ciphertext + 16-byte tag)', async () => {
      const { encryptProviderKey } = await import('../encryption');
      const plain = 'short';
      const { encrypted } = encryptProviderKey(plain);
      const ciphertextBytes = Buffer.from(encrypted, 'base64').byteLength;
      // Minimum size = plaintext bytes + 16 auth-tag bytes
      expect(ciphertextBytes).toBeGreaterThanOrEqual(Buffer.byteLength(plain, 'utf8') + 16);
    });

    it('returns an object with exactly encrypted and iv keys', async () => {
      const { encryptProviderKey } = await import('../encryption');
      const result = encryptProviderKey('key-shape');
      expect(Object.keys(result).sort()).toEqual(['encrypted', 'iv']);
    });
  });

  // ================================================================
  // 6. Key isolation — different master keys cannot cross-decrypt
  // ================================================================

  describe('key isolation', () => {
    it('ciphertext produced under one master key cannot be decrypted with another', async () => {
      const { encryptProviderKey, decryptProviderKey } = await import('../encryption');
      const { encrypted, iv } = encryptProviderKey('isolation test');

      // Switch to a different master key
      process.env.ENCRYPTION_MASTER_KEY = freshKey();
      expect(() => decryptProviderKey(encrypted, iv)).toThrow();
    });
  });
});
