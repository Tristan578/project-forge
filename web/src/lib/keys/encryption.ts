import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
// AES-256-GCM is specified to use 96-bit (12-byte) IVs for maximum security.
// Using 12 bytes is the NIST recommendation (SP 800-38D) because it avoids the
// extra GHASH computation required for non-96-bit IVs and provides the strongest
// collision resistance guarantee for random IV generation.
//
// MIGRATION NOTE: Keys stored before this change used a 16-byte IV (base64-encoded).
// The decryptProviderKey function is backwards-compatible: it reads the IV length
// from the stored base64 string at runtime, so existing 16-byte-IV ciphertexts will
// continue to decrypt correctly. Only new keys written after this change use 12-byte IVs.
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function getMasterKey(): Buffer {
  const key = process.env.ENCRYPTION_MASTER_KEY;
  if (!key || key.length !== 64) {
    throw new Error(
      'ENCRYPTION_MASTER_KEY must be a 64-character hex string (32 bytes). ' +
        'Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }
  return Buffer.from(key, 'hex');
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
