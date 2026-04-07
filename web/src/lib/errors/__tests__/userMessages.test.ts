import { describe, it, expect } from 'vitest';
import { getUserMessage, USER_MESSAGES, type ErrorCode } from '../userMessages';

describe('userMessages', () => {
  it('returns the correct entry for each known error code', () => {
    const codes: ErrorCode[] = [
      'NETWORK_ERROR', 'TIMEOUT', 'OFFLINE',
      'AUTH_EXPIRED', 'AUTH_FORBIDDEN', 'AUTH_REQUIRED',
      'PUBLISH_LIMIT', 'STORAGE_LIMIT', 'TOKEN_LIMIT', 'TIER_REQUIRED',
      'GENERATION_FAILED', 'GENERATION_TIMEOUT', 'GENERATION_CONTENT_POLICY', 'GENERATION_PROVIDER_DOWN',
      'ENGINE_INIT_FAILED', 'ENGINE_CRASH', 'ENGINE_WEBGPU_UNSUPPORTED', 'ENGINE_COMMAND_FAILED',
      'PUBLISH_FAILED', 'PUBLISH_SLUG_TAKEN',
      'SAVE_FAILED', 'LOAD_FAILED', 'ASSET_LOAD_FAILED',
      'UNKNOWN',
    ];

    for (const code of codes) {
      const entry = getUserMessage(code);
      expect(entry).toBe(USER_MESSAGES[code]);
      expect(entry.title).toBeTruthy();
      expect(entry.message).toBeTruthy();
      expect(entry.actionLabel).toBeTruthy();
      expect(entry.action).toBeTruthy();
    }
  });

  it('falls back to UNKNOWN for unrecognised codes', () => {
    const entry = getUserMessage('NOT_A_REAL_CODE');
    expect(entry).toBe(USER_MESSAGES.UNKNOWN);
  });

  it('every entry has a valid action type', () => {
    const validActions = ['retry', 'sign-in', 'upgrade', 'contact', 'dismiss', 'refresh'];
    for (const [_code, entry] of Object.entries(USER_MESSAGES)) {
      expect(validActions).toContain(entry.action);
    }
  });

  it('every title is 8 words or fewer', () => {
    for (const [code, entry] of Object.entries(USER_MESSAGES)) {
      const wordCount = entry.title.split(/\s+/).length;
      expect(wordCount, `${code} title has ${wordCount} words: "${entry.title}"`).toBeLessThanOrEqual(8);
    }
  });

  it('billing errors have upgrade action', () => {
    const billingCodes: ErrorCode[] = ['PUBLISH_LIMIT', 'STORAGE_LIMIT', 'TOKEN_LIMIT', 'TIER_REQUIRED'];
    for (const code of billingCodes) {
      expect(USER_MESSAGES[code].action).toBe('upgrade');
    }
  });

  it('auth errors have sign-in action', () => {
    expect(USER_MESSAGES.AUTH_EXPIRED.action).toBe('sign-in');
    expect(USER_MESSAGES.AUTH_REQUIRED.action).toBe('sign-in');
  });
});
