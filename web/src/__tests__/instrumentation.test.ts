/**
 * Tests for the Next.js instrumentation hook (`src/instrumentation.ts`).
 *
 * `register()` runs once per server start. Beyond Sentry init and env
 * validation, it is the flags cache's primary population path (PF-971):
 * without the awaited `primeFlagsCache()` call, a cold serverless instance
 * would evaluate every flag (kill switches, deep-tier override) against an
 * empty cache and silently fall back to env defaults.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const primeFlagsCacheMock = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
vi.mock('@/lib/flags/posthogFlags', () => ({
  primeFlagsCache: () => primeFlagsCacheMock(),
}));

const validateEnvironmentMock = vi.fn(() => ({ valid: true, missing: [] as string[] }));
vi.mock('@/lib/config/validateEnv', () => ({
  validateEnvironment: () => validateEnvironmentMock(),
}));

vi.mock('@sentry/nextjs', () => ({
  captureRequestError: vi.fn(),
}));

describe('instrumentation register()', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalSkip = process.env.SKIP_ENV_VALIDATION;

  beforeEach(() => {
    vi.resetModules();
    primeFlagsCacheMock.mockClear();
    primeFlagsCacheMock.mockResolvedValue(undefined);
    validateEnvironmentMock.mockClear();
    validateEnvironmentMock.mockReturnValue({ valid: true, missing: [] });
  });

  afterEach(() => {
    vi.stubEnv('NODE_ENV', originalNodeEnv ?? 'test');
    if (originalSkip === undefined) {
      delete process.env.SKIP_ENV_VALIDATION;
    } else {
      process.env.SKIP_ENV_VALIDATION = originalSkip;
    }
    vi.unstubAllEnvs();
  });

  it('validates the environment and warms the flags cache', async () => {
    const { register } = await import('../instrumentation');

    await register();

    expect(validateEnvironmentMock).toHaveBeenCalledTimes(1);
    expect(primeFlagsCacheMock).toHaveBeenCalledTimes(1);
  });

  it('still warms the flags cache when env validation reports missing vars outside production', async () => {
    validateEnvironmentMock.mockReturnValue({ valid: false, missing: ['DATABASE_URL'] });
    const { register } = await import('../instrumentation');

    await register();

    expect(primeFlagsCacheMock).toHaveBeenCalledTimes(1);
  });

  it('aborts before warming the cache when production env validation fails', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    delete process.env.SKIP_ENV_VALIDATION;
    validateEnvironmentMock.mockReturnValue({ valid: false, missing: ['DATABASE_URL'] });
    const { register } = await import('../instrumentation');

    await expect(register()).rejects.toThrow(/missing required environment variables/);
    expect(primeFlagsCacheMock).not.toHaveBeenCalled();
  });
});
