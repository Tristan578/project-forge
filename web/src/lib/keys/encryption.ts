import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
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
