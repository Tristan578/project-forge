/**
 * Tests for the step-up (re-verification) guard (PF-910, #8820).
 *
 * The guard is the real security enforcement: it blocks a sensitive action when
 * the session has NOT recently re-verified, allows it when it has, and — most
 * importantly for CI/E2E — NO-OPS entirely when Clerk keys are absent.
 *
 * All assertions are observable behaviour of `requireStepUp()` (the result
 * shape + HTTP status of the returned response) and the policy module. No
 * claims about UI components that don't render.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock Clerk's server auth(). `mockAuth` is reconfigured per-test.
const mockAuth = vi.fn();
vi.mock('@clerk/nextjs/server', () => ({
  auth: () => mockAuth(),
}));

import { requireStepUp } from '../step-up';
import {
  STEP_UP_ROUTES,
  EXPECTED_CLERK_PROTECTIONS,
  type StepUpConfig,
} from '../security-policy';

const ORIGINAL_ENV = { ...process.env };

/** Put the process into "Clerk configured" mode (keys look real). */
function withClerkKeys() {
  process.env.CLERK_SECRET_KEY = 'sk_test_abcdef0123456789';
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = 'pk_test_abcdef0123456789';
}

/** Put the process into "Clerk absent" mode (CI/E2E/dev). */
function withoutClerkKeys() {
  delete process.env.CLERK_SECRET_KEY;
  delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
}

const CONFIG: StepUpConfig = { level: 'second_factor', afterMinutes: 10 };

beforeEach(() => {
  mockAuth.mockReset();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('requireStepUp — no-op without Clerk env (CI/E2E safety)', () => {
  it('allows the action and never calls auth() when Clerk keys are absent', async () => {
    withoutClerkKeys();

    const result = await requireStepUp(CONFIG);

    expect(result.ok).toBe(true);
    expect(result.response).toBeUndefined();
    expect(mockAuth).not.toHaveBeenCalled();
  });

  it('treats placeholder/non-sk keys as absent (allows)', async () => {
    process.env.CLERK_SECRET_KEY = 'not-a-real-key';
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = 'also-fake';

    const result = await requireStepUp(CONFIG);

    expect(result.ok).toBe(true);
    expect(mockAuth).not.toHaveBeenCalled();
  });
});

describe('requireStepUp — enforces when Clerk is configured', () => {
  beforeEach(withClerkKeys);

  it('allows when has({ reverification }) is satisfied (fresh re-auth)', async () => {
    const has = vi.fn().mockReturnValue(true);
    mockAuth.mockResolvedValue({ userId: 'user_123', has });

    const result = await requireStepUp(CONFIG);

    expect(result.ok).toBe(true);
    expect(result.response).toBeUndefined();
    // The guard must check reverification against the exact config it was given.
    expect(has).toHaveBeenCalledWith({ reverification: CONFIG });
  });

  it('blocks with 403 + REVERIFICATION_REQUIRED when re-auth is stale/absent', async () => {
    const has = vi.fn().mockReturnValue(false);
    mockAuth.mockResolvedValue({ userId: 'user_123', has });

    const result = await requireStepUp(CONFIG);

    expect(result.ok).toBe(false);
    expect(result.response).toBeDefined();
    expect(result.response!.status).toBe(403);

    const body = await result.response!.json();
    expect(body.code).toBe('REVERIFICATION_REQUIRED');
    // The client SDK needs the level + window to launch the step-up flow.
    expect(body.reverification).toEqual({
      level: CONFIG.level,
      afterMinutes: CONFIG.afterMinutes,
    });
    // Clerk's client recognises this envelope to open the step-up modal.
    expect(body.clerk_error).toEqual({
      type: 'forbidden',
      reason: 'reverification-error',
    });
  });

  it('fails CLOSED (403) when the session has no userId despite Clerk configured', async () => {
    const has = vi.fn().mockReturnValue(true);
    mockAuth.mockResolvedValue({ userId: null, has });

    const result = await requireStepUp(CONFIG);

    expect(result.ok).toBe(false);
    expect(result.response!.status).toBe(403);
    // A missing session must not be checked for reverification — it's blocked.
    expect(has).not.toHaveBeenCalled();
  });

  it('fails CLOSED (403) when auth() throws (transient Clerk error / bad token)', async () => {
    mockAuth.mockRejectedValue(new Error('clerk down'));

    const result = await requireStepUp(CONFIG);

    expect(result.ok).toBe(false);
    expect(result.response!.status).toBe(403);
  });
});

describe('security-policy — route coverage & protection expectations', () => {
  it('declares step-up configs for every sensitive route id', () => {
    const ids = Object.keys(STEP_UP_ROUTES);
    expect(ids).toEqual(
      expect.arrayContaining([
        'user-delete',
        'keys-write',
        'billing-checkout',
        'billing-portal',
      ]),
    );
  });

  it('every step-up route has a valid level and a positive window', () => {
    for (const [id, entry] of Object.entries(STEP_UP_ROUTES)) {
      expect(entry.path, `${id} path`).toMatch(/^\/api\//);
      expect(['first_factor', 'second_factor', 'multi_factor']).toContain(
        entry.config.level,
      );
      expect(entry.config.afterMinutes).toBeGreaterThanOrEqual(1);
      expect(entry.config.afterMinutes).toBeLessThan(99_999);
    }
  });

  it('declares the three Dashboard-side protections the app expects', () => {
    const ids = EXPECTED_CLERK_PROTECTIONS.map((p) => p.id);
    expect(ids).toEqual(['mfa-totp', 'passkeys', 'bot-protection']);
  });
});
