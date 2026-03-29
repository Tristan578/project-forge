import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('environment module', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('environment constants', () => {
    it('detects development environment', async () => {
      vi.stubEnv('NODE_ENV', 'development');
      vi.stubEnv('NEXT_PUBLIC_ENVIRONMENT', '');
      const { environment } = await import('../environment');
      expect(environment.isDev).toBe(true);
    });
  });

  describe('validateEnvironment (re-exported from config/validateEnv)', () => {
    it('should skip validation in development', async () => {
      vi.stubEnv('NODE_ENV', 'development');
      const { validateEnvironment } = await import('../environment');
      const result = validateEnvironment();
      expect(result.valid).toBe(true);
      expect(result.missing).toEqual([]);
    });

    it('should report missing vars in production', async () => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('DATABASE_URL', '');
      vi.stubEnv('STRIPE_SECRET_KEY', '');
      vi.stubEnv('STRIPE_WEBHOOK_SECRET', '');
      vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', '');
      vi.stubEnv('CLERK_SECRET_KEY', '');

      const { validateEnvironment } = await import('../environment');
      const result = validateEnvironment();
      expect(result.valid).toBe(false);
      expect(result.missing).toContain('DATABASE_URL');
      expect(result.missing).toContain('STRIPE_SECRET_KEY');
    });

    it('should pass when all required vars are set', async () => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('DATABASE_URL', 'postgresql://test');
      vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'pk_live_xxx');
      vi.stubEnv('CLERK_SECRET_KEY', 'sk_live_xxx');
      vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_xxx');
      vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_xxx');
      vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://redis.upstash.io');
      vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'test-token');
      vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test');
      vi.stubEnv('ENCRYPTION_MASTER_KEY', 'a'.repeat(64));

      const { validateEnvironment } = await import('../environment');
      const result = validateEnvironment();
      expect(result.valid).toBe(true);
      expect(result.missing).toEqual([]);
    });
  });
});
