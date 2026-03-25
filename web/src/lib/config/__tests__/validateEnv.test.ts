import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('validateEnv', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    process.env = { ...originalEnv } as any;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('validateEnvironment', () => {
    it('skips validation in development and returns valid', async () => {
      (process.env as Record<string, string>).NODE_ENV = 'development';
      const { validateEnvironment } = await import('../validateEnv');
      const result = validateEnvironment();
      expect(result.valid).toBe(true);
      expect(result.missing).toEqual([]);
      expect(result.warnings).toEqual([]);
    });

    it('reports all missing required vars in production', async () => {
      (process.env as Record<string, string>).NODE_ENV = 'production';
      delete process.env.DATABASE_URL;
      delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
      delete process.env.CLERK_SECRET_KEY;
      delete process.env.STRIPE_SECRET_KEY;
      delete process.env.STRIPE_WEBHOOK_SECRET;
      delete process.env.UPSTASH_REDIS_REST_URL;
      delete process.env.UPSTASH_REDIS_REST_TOKEN;
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.ENCRYPTION_MASTER_KEY;

      const { validateEnvironment } = await import('../validateEnv');
      const result = validateEnvironment();

      expect(result.valid).toBe(false);
      expect(result.missing).toContain('DATABASE_URL');
      expect(result.missing).toContain('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY');
      expect(result.missing).toContain('CLERK_SECRET_KEY');
      expect(result.missing).toContain('STRIPE_SECRET_KEY');
      expect(result.missing).toContain('STRIPE_WEBHOOK_SECRET');
      expect(result.missing).toContain('UPSTASH_REDIS_REST_URL');
      expect(result.missing).toContain('UPSTASH_REDIS_REST_TOKEN');
      expect(result.missing).toContain('ANTHROPIC_API_KEY');
      expect(result.missing).toContain('ENCRYPTION_MASTER_KEY');
      expect(result.missing).toHaveLength(9);
    });

    it('passes when all required vars are set', async () => {
      (process.env as Record<string, string>).NODE_ENV = 'production';
      process.env.DATABASE_URL = 'postgresql://test';
      process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = 'pk_test_xxx';
      process.env.CLERK_SECRET_KEY = 'sk_test_xxx';
      process.env.STRIPE_SECRET_KEY = 'sk_test_xxx';
      process.env.STRIPE_WEBHOOK_SECRET = 'whsec_xxx';
      process.env.UPSTASH_REDIS_REST_URL = 'https://redis.upstash.io';
      process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token';
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
      process.env.ENCRYPTION_MASTER_KEY = 'a'.repeat(64);

      const { validateEnvironment } = await import('../validateEnv');
      const result = validateEnvironment();

      expect(result.valid).toBe(true);
      expect(result.missing).toEqual([]);
    });

    it('reports warnings for missing optional vars', async () => {
      (process.env as Record<string, string>).NODE_ENV = 'production';
      process.env.DATABASE_URL = 'postgresql://test';
      process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = 'pk_test_xxx';
      process.env.CLERK_SECRET_KEY = 'sk_test_xxx';
      process.env.STRIPE_SECRET_KEY = 'sk_test_xxx';
      process.env.STRIPE_WEBHOOK_SECRET = 'whsec_xxx';
      process.env.UPSTASH_REDIS_REST_URL = 'https://redis.upstash.io';
      process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token';
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
      process.env.ENCRYPTION_MASTER_KEY = 'a'.repeat(64);
      delete process.env.NEXT_PUBLIC_APP_URL;
      delete process.env.NEXT_PUBLIC_ENGINE_CDN_URL;
      delete process.env.SENTRY_DSN;
      delete process.env.NEXT_PUBLIC_SENTRY_DSN;

      const { validateEnvironment } = await import('../validateEnv');
      const result = validateEnvironment();

      expect(result.valid).toBe(true);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.some((w) => w.includes('NEXT_PUBLIC_APP_URL'))).toBe(true);
      expect(result.warnings.some((w) => w.includes('http://localhost:3000'))).toBe(true);
    });

    it('does not warn for optional vars that are set', async () => {
      (process.env as Record<string, string>).NODE_ENV = 'production';
      process.env.DATABASE_URL = 'postgresql://test';
      process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = 'pk_test_xxx';
      process.env.CLERK_SECRET_KEY = 'sk_test_xxx';
      process.env.STRIPE_SECRET_KEY = 'sk_test_xxx';
      process.env.STRIPE_WEBHOOK_SECRET = 'whsec_xxx';
      process.env.UPSTASH_REDIS_REST_URL = 'https://redis.upstash.io';
      process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token';
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
      process.env.ENCRYPTION_MASTER_KEY = 'a'.repeat(64);
      process.env.NEXT_PUBLIC_APP_URL = 'https://spawnforge.ai';
      process.env.NEXT_PUBLIC_ENGINE_CDN_URL = 'https://cdn.spawnforge.ai';
      process.env.SENTRY_DSN = 'https://xxx@sentry.io/123';
      process.env.NEXT_PUBLIC_SENTRY_DSN = 'https://xxx@sentry.io/123';
      process.env.NEXT_PUBLIC_POSTHOG_KEY = 'phc_test';
      process.env.CLOUDFLARE_ACCOUNT_ID = '0b949ff499d179e24dde841f71d6134f';

      const { validateEnvironment } = await import('../validateEnv');
      const result = validateEnvironment();

      expect(result.valid).toBe(true);
      expect(result.missing).toEqual([]);
      expect(result.warnings).toEqual([]);
    });

    it('logs error to console when required vars are missing', async () => {
      (process.env as Record<string, string>).NODE_ENV = 'production';
      delete process.env.DATABASE_URL;
      process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = 'pk_test_xxx';
      process.env.CLERK_SECRET_KEY = 'sk_test_xxx';
      process.env.STRIPE_SECRET_KEY = 'sk_test_xxx';
      process.env.STRIPE_WEBHOOK_SECRET = 'whsec_xxx';
      process.env.UPSTASH_REDIS_REST_URL = 'https://redis.upstash.io';
      process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token';
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
      process.env.ENCRYPTION_MASTER_KEY = 'a'.repeat(64);

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { validateEnvironment } = await import('../validateEnv');
      validateEnvironment();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('DATABASE_URL')
      );
      consoleSpy.mockRestore();
    });

    it('reports partial missing — only missing vars appear', async () => {
      (process.env as Record<string, string>).NODE_ENV = 'production';
      process.env.DATABASE_URL = 'postgresql://test';
      process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = 'pk_test_xxx';
      process.env.CLERK_SECRET_KEY = 'sk_test_xxx';
      delete process.env.STRIPE_SECRET_KEY;
      delete process.env.STRIPE_WEBHOOK_SECRET;
      process.env.UPSTASH_REDIS_REST_URL = 'https://redis.upstash.io';
      process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token';
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
      process.env.ENCRYPTION_MASTER_KEY = 'a'.repeat(64);

      const { validateEnvironment } = await import('../validateEnv');
      const result = validateEnvironment();

      expect(result.valid).toBe(false);
      expect(result.missing).toEqual(['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET']);
    });
  });

  describe('getOptionalEnv', () => {
    it('returns the env value when set', async () => {
      process.env.NEXT_PUBLIC_APP_URL = 'https://spawnforge.ai';
      const { getOptionalEnv } = await import('../validateEnv');
      expect(getOptionalEnv('NEXT_PUBLIC_APP_URL')).toBe('https://spawnforge.ai');
    });

    it('returns the configured default when env var is not set', async () => {
      delete process.env.NEXT_PUBLIC_APP_URL;
      const { getOptionalEnv } = await import('../validateEnv');
      expect(getOptionalEnv('NEXT_PUBLIC_APP_URL')).toBe('http://localhost:3000');
    });

    it('returns empty string for unknown keys', async () => {
      const { getOptionalEnv } = await import('../validateEnv');
      expect(getOptionalEnv('TOTALLY_UNKNOWN_VAR')).toBe('');
    });

    it('returns empty string default for optional vars with empty default', async () => {
      delete process.env.NEXT_PUBLIC_ENGINE_CDN_URL;
      const { getOptionalEnv } = await import('../validateEnv');
      expect(getOptionalEnv('NEXT_PUBLIC_ENGINE_CDN_URL')).toBe('');
    });
  });

  describe('exported constants', () => {
    it('exports REQUIRED_VARS with expected keys', async () => {
      const { REQUIRED_VARS } = await import('../validateEnv');
      const keys = REQUIRED_VARS.map((v) => v.key);
      expect(keys).toContain('DATABASE_URL');
      expect(keys).toContain('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY');
      expect(keys).toContain('CLERK_SECRET_KEY');
      expect(keys).toContain('STRIPE_SECRET_KEY');
      expect(keys).toContain('STRIPE_WEBHOOK_SECRET');
      expect(keys).toContain('UPSTASH_REDIS_REST_URL');
      expect(keys).toContain('UPSTASH_REDIS_REST_TOKEN');
      expect(keys).toContain('ANTHROPIC_API_KEY');
      expect(keys).toContain('ENCRYPTION_MASTER_KEY');
    });

    it('exports OPTIONAL_VARS with PostHog and Cloudflare keys', async () => {
      const { OPTIONAL_VARS } = await import('../validateEnv');
      const keys = OPTIONAL_VARS.map((v) => v.key);
      expect(keys).toContain('NEXT_PUBLIC_POSTHOG_KEY');
      expect(keys).toContain('CLOUDFLARE_ACCOUNT_ID');
    });

    it('exports OPTIONAL_VARS with defaults', async () => {
      const { OPTIONAL_VARS } = await import('../validateEnv');
      const appUrl = OPTIONAL_VARS.find((v) => v.key === 'NEXT_PUBLIC_APP_URL');
      expect(appUrl).not.toBeUndefined();
      expect(appUrl!.defaultValue).toBe('http://localhost:3000');
    });
  });
});
