import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('validateEnvironment', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    process.env = { ...originalEnv } as any;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should skip validation in development', async () => {
    (process.env as Record<string, string>).NODE_ENV = 'development';
    const { validateEnvironment } = await import('../environment');
    const result = validateEnvironment();
    expect(result.valid).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it('should report missing vars in production', async () => {
    (process.env as Record<string, string>).NODE_ENV = 'production';
    process.env.NEXT_PUBLIC_ENVIRONMENT = 'production';
    delete process.env.DATABASE_URL;
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.STRIPE_PRICE_STARTER;
    delete process.env.STRIPE_PRICE_CREATOR;
    delete process.env.STRIPE_PRICE_STUDIO;
    delete process.env.ENCRYPTION_MASTER_KEY;
    delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
    delete process.env.CLERK_SECRET_KEY;

    const { validateEnvironment } = await import('../environment');
    const result = validateEnvironment();
    expect(result.valid).toBe(false);
    expect(result.missing).toContain('DATABASE_URL');
    expect(result.missing).toContain('STRIPE_SECRET_KEY');
    expect(result.missing).toContain('ENCRYPTION_MASTER_KEY');
  });

  it('should pass when all required vars are set', async () => {
    (process.env as Record<string, string>).NODE_ENV = 'production';
    process.env.NEXT_PUBLIC_ENVIRONMENT = 'production';
    process.env.DATABASE_URL = 'postgresql://test';
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = 'pk_test_xxx';
    process.env.CLERK_SECRET_KEY = 'sk_test_xxx';
    process.env.STRIPE_SECRET_KEY = 'sk_test_xxx';
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_xxx';
    process.env.STRIPE_PRICE_STARTER = 'price_xxx';
    process.env.STRIPE_PRICE_CREATOR = 'price_xxx';
    process.env.STRIPE_PRICE_STUDIO = 'price_xxx';
    process.env.ENCRYPTION_MASTER_KEY = 'a'.repeat(64);

    const { validateEnvironment } = await import('../environment');
    const result = validateEnvironment();
    expect(result.valid).toBe(true);
    expect(result.missing).toEqual([]);
  });
});
