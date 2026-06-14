import { describe, it, expect, afterEach, vi } from 'vitest';
import { e2eHooksEnabled } from '../testHooks';

describe('e2eHooksEnabled', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is enabled in a non-production build regardless of the flag', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('NEXT_PUBLIC_E2E_HOOKS', '');
    expect(e2eHooksEnabled()).toBe(true);
  });

  it('is enabled in a test build', () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('NEXT_PUBLIC_E2E_HOOKS', '');
    expect(e2eHooksEnabled()).toBe(true);
  });

  it('is DISABLED in a production build by default (no flag)', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_E2E_HOOKS', '');
    expect(e2eHooksEnabled()).toBe(false);
  });

  it('is ENABLED in a production build only when the flag is exactly "true"', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_E2E_HOOKS', 'true');
    expect(e2eHooksEnabled()).toBe(true);
  });

  it('stays DISABLED in production for any non-"true" flag value', () => {
    vi.stubEnv('NODE_ENV', 'production');
    for (const value of ['1', 'TRUE', 'yes', 'on', ' true', 'true ', 'false']) {
      vi.stubEnv('NEXT_PUBLIC_E2E_HOOKS', value);
      expect(e2eHooksEnabled(), `value=${JSON.stringify(value)}`).toBe(false);
    }
  });
});
