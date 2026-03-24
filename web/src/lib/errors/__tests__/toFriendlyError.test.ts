import { describe, it, expect } from 'vitest';
import { toFriendlyError } from '../toFriendlyError';

describe('toFriendlyError', () => {
  // ─── Error objects ─────────────────────────────────────────────────────────

  it('classifies a network Error by message keyword', () => {
    const result = toFriendlyError(new Error('Failed to fetch'));
    expect(result.code).toBe('NETWORK_ERROR');
    expect(result.title).not.toBeNull();
    expect(result.message).not.toBeNull();
    expect(result.actionLabel).not.toBeNull();
    expect(result.action).toBe('retry');
  });

  it('classifies a timeout Error', () => {
    const result = toFriendlyError(new Error('Request timed out'));
    expect(result.code).toBe('TIMEOUT');
    expect(result.action).toBe('retry');
  });

  it('classifies an auth Error by "unauthorized" keyword', () => {
    const result = toFriendlyError(new Error('401 Unauthorized'));
    expect(result.code).toBe('AUTH_REQUIRED');
    expect(result.action).toBe('sign-in');
  });

  it('classifies an expired session Error', () => {
    const result = toFriendlyError(new Error('session expired'));
    expect(result.code).toBe('AUTH_EXPIRED');
    expect(result.action).toBe('sign-in');
  });

  it('classifies a publish Error', () => {
    const result = toFriendlyError(new Error('publish failed'));
    expect(result.code).toBe('PUBLISH_FAILED');
  });

  it('classifies a save Error', () => {
    const result = toFriendlyError(new Error('save error'));
    expect(result.code).toBe('SAVE_FAILED');
  });

  it('classifies an engine Error', () => {
    const result = toFriendlyError(new Error('engine crashed'));
    expect(result.code).toBe('ENGINE_COMMAND_FAILED');
  });

  it('falls back to UNKNOWN for a generic Error message', () => {
    const result = toFriendlyError(new Error('Unexpected error'));
    expect(result.code).toBe('UNKNOWN');
    expect(result.title).toBe('Something went wrong');
  });

  // ─── Response-like objects (fetch responses) ───────────────────────────────

  it('classifies a 401 Response status as AUTH_REQUIRED', () => {
    const result = toFriendlyError({ status: 401 });
    expect(result.code).toBe('AUTH_REQUIRED');
    expect(result.action).toBe('sign-in');
  });

  it('classifies a 403 Response status as AUTH_FORBIDDEN', () => {
    const result = toFriendlyError({ status: 403 });
    expect(result.code).toBe('AUTH_FORBIDDEN');
  });

  it('classifies a 408 Response status as TIMEOUT', () => {
    const result = toFriendlyError({ status: 408 });
    expect(result.code).toBe('TIMEOUT');
  });

  it('classifies a 429 Response status as TOKEN_LIMIT', () => {
    const result = toFriendlyError({ status: 429 });
    expect(result.code).toBe('TOKEN_LIMIT');
    expect(result.action).toBe('upgrade');
  });

  it('classifies a 500 Response status as NETWORK_ERROR', () => {
    const result = toFriendlyError({ status: 500 });
    expect(result.code).toBe('NETWORK_ERROR');
  });

  it('classifies a 503 Response status as NETWORK_ERROR', () => {
    const result = toFriendlyError({ status: 503 });
    expect(result.code).toBe('NETWORK_ERROR');
  });

  // ─── Objects with explicit code field ─────────────────────────────────────

  it('uses a known code field directly', () => {
    const result = toFriendlyError({ code: 'PUBLISH_LIMIT' });
    expect(result.code).toBe('PUBLISH_LIMIT');
    expect(result.action).toBe('upgrade');
  });

  it('uses GENERATION_FAILED code from an object', () => {
    const result = toFriendlyError({ code: 'GENERATION_FAILED' });
    expect(result.code).toBe('GENERATION_FAILED');
    expect(result.action).toBe('retry');
  });

  it('falls back to UNKNOWN for an unknown code field', () => {
    const result = toFriendlyError({ code: 'SOME_INTERNAL_CODE_XYZ' });
    expect(result.code).toBe('SOME_INTERNAL_CODE_XYZ');
    expect(result.title).toBe('Something went wrong');
  });

  // ─── String errors ─────────────────────────────────────────────────────────

  it('classifies a network string message', () => {
    const result = toFriendlyError('network failure');
    expect(result.code).toBe('NETWORK_ERROR');
  });

  it('classifies an offline string message', () => {
    const result = toFriendlyError('you are offline');
    expect(result.code).toBe('OFFLINE');
  });

  it('classifies an AI generation string message', () => {
    const result = toFriendlyError('AI generation failed');
    expect(result.code).toBe('GENERATION_FAILED');
  });

  it('falls back to UNKNOWN for an empty string', () => {
    const result = toFriendlyError('');
    expect(result.code).toBe('UNKNOWN');
  });

  // ─── Edge cases ────────────────────────────────────────────────────────────

  it('handles null gracefully', () => {
    const result = toFriendlyError(null);
    expect(result.code).toBe('UNKNOWN');
    expect(result.title).toBe('Something went wrong');
  });

  it('handles undefined gracefully', () => {
    const result = toFriendlyError(undefined);
    expect(result.code).toBe('UNKNOWN');
    expect(result.title).toBe('Something went wrong');
  });

  it('handles a number gracefully', () => {
    const result = toFriendlyError(42);
    expect(result.code).toBe('UNKNOWN');
  });

  it('handles an empty object gracefully', () => {
    const result = toFriendlyError({});
    expect(result.code).toBe('UNKNOWN');
  });

  // ─── Result shape ──────────────────────────────────────────────────────────

  it('always returns a FriendlyError with all required fields', () => {
    const result = toFriendlyError(new Error('something'));
    expect(typeof result.title).toBe('string');
    expect(typeof result.message).toBe('string');
    expect(typeof result.actionLabel).toBe('string');
    expect(typeof result.action).toBe('string');
    expect(typeof result.code).toBe('string');
    // Never expose raw error codes or technical jargon to users
    expect(result.title.length).toBeGreaterThan(0);
    expect(result.message.length).toBeGreaterThan(0);
  });

  it('never contains HTTP status numbers in title or message', () => {
    const result = toFriendlyError({ status: 500 });
    expect(result.title).not.toContain('500');
    expect(result.message).not.toContain('500');
  });

  it('never contains "Internal Server Error" in the user-facing text', () => {
    const result = toFriendlyError(new Error('500 Internal Server Error'));
    expect(result.title).not.toContain('Internal Server Error');
    expect(result.message).not.toContain('Internal Server Error');
  });
});
