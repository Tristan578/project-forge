import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/** Stub all required env vars to valid production values. */
function stubAllRequired(): void {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('DATABASE_URL', 'postgresql://test');
  vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'pk_live_xxx');
  vi.stubEnv('CLERK_SECRET_KEY', 'sk_live_xxx');
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_live_xxx');
  vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_xxx');
  vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://redis.upstash.io');
  vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'test-token');
  vi.stubEnv('ENCRYPTION_MASTER_KEY', 'a'.repeat(64));
}

describe('validateEnv', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('validateEnvironment', () => {
    it('skips validation in development and returns valid', async () => {
      vi.stubEnv('NODE_ENV', 'development');
      const { validateEnvironment } = await import('../validateEnv');
      const result = validateEnvironment();
      expect(result.valid).toBe(true);
      expect(result.missing).toEqual([]);
      expect(result.warnings).toEqual([]);
    });

    it('reports all missing required vars in production', async () => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('DATABASE_URL', '');
      vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', '');
      vi.stubEnv('CLERK_SECRET_KEY', '');
      vi.stubEnv('STRIPE_SECRET_KEY', '');
      vi.stubEnv('STRIPE_WEBHOOK_SECRET', '');
      vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
      vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
      vi.stubEnv('ENCRYPTION_MASTER_KEY', '');

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
      expect(result.missing).toContain('ENCRYPTION_MASTER_KEY');
      expect(result.missing).toHaveLength(8);
    });

    it('passes when all required vars are set', async () => {
      stubAllRequired();

      const { validateEnvironment } = await import('../validateEnv');
      const result = validateEnvironment();

      expect(result.valid).toBe(true);
      expect(result.missing).toEqual([]);
    });

    it('reports warnings for missing optional vars', async () => {
      stubAllRequired();
      vi.stubEnv('NEXT_PUBLIC_APP_URL', '');
      vi.stubEnv('NEXT_PUBLIC_ENGINE_CDN_URL', '');
      vi.stubEnv('SENTRY_DSN', '');
      vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', '');

      const { validateEnvironment } = await import('../validateEnv');
      const result = validateEnvironment();

      expect(result.valid).toBe(true);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.some((w) => w.includes('NEXT_PUBLIC_APP_URL'))).toBe(true);
      expect(result.warnings.some((w) => w.includes('http://localhost:3000'))).toBe(true);
    });

    it('does not warn for optional vars that are set', async () => {
      stubAllRequired();
      vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
      vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://spawnforge.ai');
      vi.stubEnv('NEXT_PUBLIC_ENGINE_CDN_URL', 'https://cdn.spawnforge.ai');
      vi.stubEnv('SENTRY_DSN', 'https://xxx@sentry.io/123');
      vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', 'https://xxx@sentry.io/123');
      vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_test');
      vi.stubEnv('CLOUDFLARE_ACCOUNT_ID', '0b949ff499d179e24dde841f71d6134f');
      vi.stubEnv('ADMIN_USER_IDS', 'user_abc123');

      const { validateEnvironment } = await import('../validateEnv');
      const result = validateEnvironment();

      expect(result.valid).toBe(true);
      expect(result.missing).toEqual([]);
      expect(result.warnings).toEqual([]);
    });

    it('logs error to console when required vars are missing', async () => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('DATABASE_URL', '');
      vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'pk_live_xxx');
      vi.stubEnv('CLERK_SECRET_KEY', 'sk_live_xxx');
      vi.stubEnv('STRIPE_SECRET_KEY', 'sk_live_xxx');
      vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_xxx');
      vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://redis.upstash.io');
      vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'test-token');
      vi.stubEnv('ENCRYPTION_MASTER_KEY', 'a'.repeat(64));

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { validateEnvironment } = await import('../validateEnv');
      validateEnvironment();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('DATABASE_URL')
      );
      consoleSpy.mockRestore();
    });

    it('reports partial missing — only missing vars appear', async () => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('DATABASE_URL', 'postgresql://test');
      vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'pk_live_xxx');
      vi.stubEnv('CLERK_SECRET_KEY', 'sk_live_xxx');
      vi.stubEnv('STRIPE_SECRET_KEY', '');
      vi.stubEnv('STRIPE_WEBHOOK_SECRET', '');
      vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://redis.upstash.io');
      vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'test-token');
      vi.stubEnv('ENCRYPTION_MASTER_KEY', 'a'.repeat(64));

      const { validateEnvironment } = await import('../validateEnv');
      const result = validateEnvironment();

      expect(result.valid).toBe(false);
      expect(result.missing).toEqual(['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET']);
    });
  });

  describe('Clerk key format validation', () => {
    it('flags pk_test_ Clerk key as invalid in production', async () => {
      stubAllRequired();
      vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'pk_test_xxx');
      vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_stripe');

      const { validateEnvironment } = await import('../validateEnv');
      const result = validateEnvironment();

      expect(result.valid).toBe(false);
      expect(result.missing).toContain('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY');
    });

    it('warns on sk_test_ Clerk secret key in production', async () => {
      stubAllRequired();
      vi.stubEnv('CLERK_SECRET_KEY', 'sk_test_xxx');
      vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_stripe');

      const { validateEnvironment } = await import('../validateEnv');
      const result = validateEnvironment();

      expect(result.warnings.some((w) => w.includes('sk_test_'))).toBe(true);
    });

    it('accepts pk_live_ and sk_live_ keys in production', async () => {
      stubAllRequired();
      vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_stripe');

      const { validateEnvironment } = await import('../validateEnv');
      const result = validateEnvironment();

      expect(result.valid).toBe(true);
      expect(result.missing).not.toContain('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY');
    });
  });

  describe('Encryption master key format validation (#8641)', () => {
    it('flags a 64-char non-hex ENCRYPTION_MASTER_KEY as missing/invalid', async () => {
      stubAllRequired();
      vi.stubEnv('ENCRYPTION_MASTER_KEY', 'z'.repeat(64)); // right length, non-hex

      const { validateEnvironment } = await import('../validateEnv');
      const result = validateEnvironment();

      expect(result.valid).toBe(false);
      expect(result.missing).toContain('ENCRYPTION_MASTER_KEY');
    });

    it('does not double-count an absent key already flagged as missing', async () => {
      stubAllRequired();
      vi.stubEnv('ENCRYPTION_MASTER_KEY', '');

      const { validateEnvironment } = await import('../validateEnv');
      const result = validateEnvironment();

      const occurrences = result.missing.filter((k) => k === 'ENCRYPTION_MASTER_KEY');
      expect(occurrences).toHaveLength(1);
    });

    it('accepts a valid 64-char hex key (upper and lower case)', async () => {
      stubAllRequired();
      vi.stubEnv('ENCRYPTION_MASTER_KEY', 'A1b2'.repeat(16)); // 64 hex chars

      const { validateEnvironment } = await import('../validateEnv');
      const result = validateEnvironment();

      expect(result.missing).not.toContain('ENCRYPTION_MASTER_KEY');
    });

    it('logs a CRITICAL message for a malformed key', async () => {
      stubAllRequired();
      vi.stubEnv('ENCRYPTION_MASTER_KEY', 'g'.repeat(64));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const { validateEnvironment } = await import('../validateEnv');
      validateEnvironment();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('ENCRYPTION_MASTER_KEY is set but is not a 64-character hex string')
      );
      consoleSpy.mockRestore();
    });
  });

  describe('getOptionalEnv', () => {
    it('returns the env value when set', async () => {
      vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://spawnforge.ai');
      const { getOptionalEnv } = await import('../validateEnv');
      expect(getOptionalEnv('NEXT_PUBLIC_APP_URL')).toBe('https://spawnforge.ai');
    });

    it('returns the configured default when env var is not set', async () => {
      vi.stubEnv('NEXT_PUBLIC_APP_URL', '');
      const { getOptionalEnv } = await import('../validateEnv');
      expect(getOptionalEnv('NEXT_PUBLIC_APP_URL')).toBe('http://localhost:3000');
    });

    it('returns empty string for unknown keys', async () => {
      const { getOptionalEnv } = await import('../validateEnv');
      expect(getOptionalEnv('TOTALLY_UNKNOWN_VAR')).toBe('');
    });

    it('returns empty string default for optional vars with empty default', async () => {
      vi.stubEnv('NEXT_PUBLIC_ENGINE_CDN_URL', '');
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
      expect(keys).toContain('ENCRYPTION_MASTER_KEY');
    });

    it('exports OPTIONAL_VARS with PostHog, Cloudflare, and Anthropic keys', async () => {
      const { OPTIONAL_VARS } = await import('../validateEnv');
      const keys = OPTIONAL_VARS.map((v) => v.key);
      expect(keys).toContain('NEXT_PUBLIC_POSTHOG_KEY');
      expect(keys).toContain('CLOUDFLARE_ACCOUNT_ID');
      expect(keys).toContain('ANTHROPIC_API_KEY');
    });

    it('exports OPTIONAL_VARS with defaults', async () => {
      const { OPTIONAL_VARS } = await import('../validateEnv');
      const appUrl = OPTIONAL_VARS.find((v) => v.key === 'NEXT_PUBLIC_APP_URL');
      expect(appUrl).toBeDefined();
      expect(appUrl!.defaultValue).toBe('http://localhost:3000');
    });
  });
});
