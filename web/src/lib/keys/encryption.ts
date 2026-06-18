import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
// IV_LENGTH = 16 (128-bit). NIST SP 800-38D recommends 96-bit (12-byte) IVs for
// AES-GCM, but changing this requires a key re-encryption migration for existing
// stored keys. The current 16-byte IV is functionally secure — GCM handles non-96-bit
// IVs via GHASH with a negligible theoretical collision risk at current scale.
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

/** A valid AES-256 master key: exactly 64 hexadecimal characters (32 bytes). */
export const MASTER_KEY_HEX = /^[0-9a-fA-F]{64}$/;

function getMasterKey(): Buffer {
  const key = process.env.ENCRYPTION_MASTER_KEY;
  // Validate hex charset, not just length: Buffer.from(s, 'hex') silently stops
  // at the first non-hex character, so a 64-char non-hex string (e.g. all 'z')
  // yields a 0-byte buffer that only fails at createCipheriv time with a cryptic
  // 'Invalid key length'. Reject it here with a clear message instead (#8641).
  if (!key || !MASTER_KEY_HEX.test(key)) {
    throw new Error(
      'ENCRYPTION_MASTER_KEY must be a 64-character hex string (32 bytes). ' +
        'Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }
  const buf = Buffer.from(key, 'hex');
  // Defense-in-depth: the regex already guarantees 32 bytes, but assert it so a
  // future regex change can never silently produce a short key.
  if (buf.length !== 32) {
    throw new Error('ENCRYPTION_MASTER_KEY must decode to exactly 32 bytes.');
  }
  return buf;
}

/** Encrypt a provider API key for storage at rest */
export function encryptProviderKey(plainKey: string): { encrypted: string; iv: string } {
  const masterKey = getMasterKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, masterKey, iv);
  const encrypted = Buffer.concat([cipher.update(plainKey, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    encrypted: Buffer.concat([encrypted, tag]).toString('base64'),
    iv: iv.toString('base64'),
  };
}

/** Decrypt a stored provider API key (server-side only, in-memory, never logged) */
export function decryptProviderKey(encrypted: string, iv: string): string {
  const masterKey = getMasterKey();
  const buf = Buffer.from(encrypted, 'base64');
  const tag = buf.subarray(buf.length - TAG_LENGTH);
  const data = buf.subarray(0, buf.length - TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, masterKey, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(tag);
  return decipher.update(data).toString('utf8') + decipher.final('utf8');
}
