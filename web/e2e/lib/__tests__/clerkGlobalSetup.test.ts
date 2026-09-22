/**
 * Unit tests for `../clerkGlobalSetup.ts` — the Playwright globalSetup of the
 * Clerk-keyed auth-journey job (#8632).
 *
 * Contract: with no keys on an optional run it returns WITHOUT throwing and
 * publishes nothing (fork PRs must still go green); with test keys it publishes
 * the Frontend API host and a testing token for the workers; and it turns a
 * missing or unusable seeded user into a named failure before any browser
 * starts, instead of a sign-in form that times out.
 */
import { describe, expect, it, vi } from 'vitest';
import { prepareClerkTesting } from '../clerkGlobalSetup';

const FAPI = 'happy-hippo-1.clerk.accounts.dev';
const PK = 'pk_test_' + Buffer.from(`${FAPI}$`, 'utf8').toString('base64');
const SK = 'sk_test_FAKEsecretFORunitTESTS0000000000';

function deps(user: { id: string; passwordEnabled: boolean; twoFactorEnabled: boolean } | null = {
  id: 'user_1',
  passwordEnabled: true,
  twoFactorEnabled: false,
}) {
  return {
    createTestingToken: vi.fn(async () => 'tok-123'),
    findSeededUser: vi.fn(async () => user),
    log: vi.fn(),
  };
}

const keys = { CLERK_SECRET_KEY: SK, NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: PK };
const creds = { E2E_CLERK_TEST_EMAIL: 'e2e+clerk_test@example.com', E2E_CLERK_TEST_PASSWORD: 'pw' };

describe('prepareClerkTesting', () => {
  it('returns early without throwing or calling Clerk when keys are absent', async () => {
    const env: Record<string, string | undefined> = {};
    const d = deps();

    await expect(prepareClerkTesting(env, d)).resolves.toBeUndefined();

    expect(d.createTestingToken).not.toHaveBeenCalled();
    expect(env.CLERK_TESTING_TOKEN).toBeUndefined();
    expect(env.CLERK_FAPI).toBeUndefined();
    expect(d.log.mock.calls.flat().join('\n')).toMatch(/not configured/);
  });

  it('throws before any network call when a required run has no keys', async () => {
    const d = deps();
    await expect(prepareClerkTesting({ E2E_CLERK_TEST_REQUIRED: 'true' }, d)).rejects.toThrow(
      /E2E_CLERK_TEST_REQUIRED=true/,
    );
    expect(d.createTestingToken).not.toHaveBeenCalled();
  });

  it('publishes the Frontend API host and the testing token for the workers', async () => {
    const env: Record<string, string | undefined> = { ...keys, ...creds };
    const d = deps();

    await prepareClerkTesting(env, d);

    expect(d.createTestingToken).toHaveBeenCalledWith(SK);
    expect(d.findSeededUser).toHaveBeenCalledWith(SK, creds.E2E_CLERK_TEST_EMAIL);
    expect(env.CLERK_FAPI).toBe(FAPI);
    expect(env.CLERK_TESTING_TOKEN).toBe('tok-123');
    const logged = d.log.mock.calls.flat().join('\n');
    expect(logged).toContain(FAPI);
    expect(logged).toMatch(/\+clerk_test address: yes/);
    expect(logged).not.toContain(SK);
    expect(logged).not.toContain('tok-123');
  });

  it('skips the user lookup when no credentials are configured on an optional run', async () => {
    const env: Record<string, string | undefined> = { ...keys };
    const d = deps();

    await prepareClerkTesting(env, d);

    expect(d.findSeededUser).not.toHaveBeenCalled();
    expect(env.CLERK_TESTING_TOKEN).toBe('tok-123');
  });

  it('names a seeded user that does not exist on the test instance', async () => {
    await expect(prepareClerkTesting({ ...keys, ...creds }, deps(null))).rejects.toThrow(
      /no user.*E2E_CLERK_TEST_EMAIL.*e2e-clerk-test-user\.md/s,
    );
  });

  it('names a seeded user that cannot sign in with a password', async () => {
    await expect(
      prepareClerkTesting({ ...keys, ...creds }, deps({ id: 'user_1', passwordEnabled: false, twoFactorEnabled: false })),
    ).rejects.toThrow(/password/);
  });

  it('names a seeded user with MFA enabled, which the journey cannot complete', async () => {
    await expect(
      prepareClerkTesting({ ...keys, ...creds }, deps({ id: 'user_1', passwordEnabled: true, twoFactorEnabled: true })),
    ).rejects.toThrow(/two-factor/);
  });

  it('reports a non-test address without failing (Device Trust may never ask for a code)', async () => {
    const env: Record<string, string | undefined> = { ...keys, ...creds, E2E_CLERK_TEST_EMAIL: 'e2e@example.com' };
    const d = deps();

    await prepareClerkTesting(env, d);

    expect(d.log.mock.calls.flat().join('\n')).toMatch(/\+clerk_test address: no/);
  });
});
