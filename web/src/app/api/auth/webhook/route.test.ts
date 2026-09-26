vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { POST } from './route';
import { NextRequest } from 'next/server';
import { syncUserFromClerk, getUserByClerkId, deleteUserAccount } from '@/lib/auth/user-service';
import { grantTrialTokens } from '@/lib/billing/trial-grant';
import { enqueueRetry } from '@/lib/auth/webhookRetry';

vi.mock('@/lib/auth/user-service');
vi.mock('@/lib/billing/trial-grant');
vi.mock('@/lib/monitoring/sentry-server', () => ({
  captureException: vi.fn(),
}));
// Keep the real isTransientError/processRetryQueue; only the enqueue is
// observed, so the grant-failure test can prove the retry path fired.
vi.mock('@/lib/auth/webhookRetry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/webhookRetry')>()),
  enqueueRetry: vi.fn(),
}));

/** A synced user row as syncUserFromClerk returns it; only `id` matters here. */
const SYNCED_USER = { id: 'internal-uuid', clerkId: 'clerk_123', email: 'u@example.com' } as never;

// Clerk's verifyWebhook() does header extraction + signature verification
// itself (#9629); the route's contract is what it does with the verdict.
const mockVerify = vi.fn();
vi.mock('@clerk/nextjs/webhooks', () => ({
  verifyWebhook: (...args: unknown[]) => mockVerify(...args),
}));

describe('POST /api/auth/webhook', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv('CLERK_WEBHOOK_SECRET', 'whsec_mock');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns 500 if WEBHOOK_SECRET is missing', async () => {
    vi.stubEnv('CLERK_WEBHOOK_SECRET', '');
    const req = new NextRequest('http://localhost/api/auth/webhook', { method: 'POST' });
    const res = await POST(req);
    expect(res.status).toBe(500);
  });

  it('returns 400 if verification rejects for missing svix headers', async () => {
    mockVerify.mockRejectedValueOnce(new Error('Missing required Svix headers'));
    const req = new NextRequest('http://localhost/api/auth/webhook', { method: 'POST' });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(syncUserFromClerk).not.toHaveBeenCalled();
  });

  it('returns 400 if signature is invalid', async () => {
    mockVerify.mockRejectedValueOnce(new Error('Invalid signature'));
    const req = new NextRequest('http://localhost/api/auth/webhook', {
      method: 'POST',
      body: JSON.stringify({ type: 'user.created' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(syncUserFromClerk).not.toHaveBeenCalled();
  });

  it('passes the request and the CLERK_WEBHOOK_SECRET explicitly (verifyWebhook falls back to a differently named variable)', async () => {
    mockVerify.mockResolvedValue({ type: 'user.updated', data: { id: 'clerk_123', email_addresses: [] } });
    const req = new NextRequest('http://localhost/api/auth/webhook', { method: 'POST', body: '{}' });
    await POST(req);
    expect(mockVerify).toHaveBeenCalledTimes(1);
    expect(mockVerify).toHaveBeenCalledWith(req, { signingSecret: 'whsec_mock' });
  });

  it('syncs user on user.created event and grants the trial tokens to the INTERNAL user id (#7715)', async () => {
    // Without a resolved user, `user.id` would throw a TypeError, which
    // isTransientError treats as transient and the route answers 200 — the
    // break would be masked. The synced row must be real for this path to run.
    vi.mocked(syncUserFromClerk).mockResolvedValue(SYNCED_USER);
    vi.mocked(grantTrialTokens).mockResolvedValue(undefined);
    mockVerify.mockResolvedValue({
      type: 'user.created',
      data: { id: 'clerk_123', email_addresses: [] },
    });

    const req = new NextRequest('http://localhost/api/auth/webhook', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
    expect(syncUserFromClerk).toHaveBeenCalledWith({ id: 'clerk_123', email_addresses: [] });
    expect(grantTrialTokens).toHaveBeenCalledTimes(1);
    expect(grantTrialTokens).toHaveBeenCalledWith('internal-uuid');
    expect(grantTrialTokens).not.toHaveBeenCalledWith('clerk_123');
    expect(enqueueRetry).not.toHaveBeenCalled();
  });

  it('syncs user on user.updated event and never grants trial tokens (#7715)', async () => {
    vi.mocked(syncUserFromClerk).mockResolvedValue(SYNCED_USER);
    mockVerify.mockResolvedValue({
      type: 'user.updated',
      data: { id: 'clerk_123', email_addresses: [] },
    });

    const req = new NextRequest('http://localhost/api/auth/webhook', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(syncUserFromClerk).toHaveBeenCalledWith({ id: 'clerk_123', email_addresses: [] });
    expect(grantTrialTokens).not.toHaveBeenCalled();
  });

  it('captures a trial-grant failure with its context, then lets the transient path queue a retry (#7715)', async () => {
    const { captureException } = await import('@/lib/monitoring/sentry-server');
    vi.mocked(syncUserFromClerk).mockResolvedValue(SYNCED_USER);
    // "database" + "connection" both classify as transient in isTransientError.
    const failure = new Error('database connection reset by peer');
    vi.mocked(grantTrialTokens).mockRejectedValue(failure);
    mockVerify.mockResolvedValue({
      type: 'user.created',
      data: { id: 'clerk_123', email_addresses: [] },
    });

    const req = new NextRequest('http://localhost/api/auth/webhook', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const res = await POST(req);

    // Captured at the grant site with the triage breadcrumb, BEFORE the error
    // propagates to the route's transient/permanent decision.
    expect(captureException).toHaveBeenCalledWith(failure, {
      context: 'trial-token-grant-failure',
      userId: 'internal-uuid',
    });
    // The error propagated: the route classified it as transient, queued the
    // event for the internal retry loop and answered 200 so Clerk does not
    // also retry.
    expect(enqueueRetry).toHaveBeenCalledTimes(1);
    expect(enqueueRetry).toHaveBeenCalledWith(
      'user.created',
      { id: 'clerk_123', email_addresses: [] },
      failure,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, queued: true });
  });

  it('answers 500 and captures the permanent error when the trial grant fails non-transiently (#7715)', async () => {
    const { captureException } = await import('@/lib/monitoring/sentry-server');
    vi.mocked(syncUserFromClerk).mockResolvedValue(SYNCED_USER);
    const failure = new Error('violates check constraint');
    vi.mocked(grantTrialTokens).mockRejectedValue(failure);
    mockVerify.mockResolvedValue({
      type: 'user.created',
      data: { id: 'clerk_123', email_addresses: [] },
    });

    const req = new NextRequest('http://localhost/api/auth/webhook', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const res = await POST(req);

    expect(res.status).toBe(500);
    expect(enqueueRetry).not.toHaveBeenCalled();
    expect(captureException).toHaveBeenCalledWith(failure, {
      context: 'trial-token-grant-failure',
      userId: 'internal-uuid',
    });
    // The response body is fixed text; the upstream message never reaches the client.
    expect(await res.json()).toEqual({ error: 'Failed to process event' });
  });

  // PF-840 regression: user.deleted must cascade-delete user data, not be ignored.
  it('deletes user data on user.deleted event when user exists (PF-840)', async () => {
    mockVerify.mockResolvedValue({
      type: 'user.deleted',
      data: { id: 'clerk_123' },
    });
    vi.mocked(getUserByClerkId).mockResolvedValue({ id: 'internal-uuid', clerkId: 'clerk_123' } as never);
    vi.mocked(deleteUserAccount).mockResolvedValue(undefined);

    const req = new NextRequest('http://localhost/api/auth/webhook', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(getUserByClerkId).toHaveBeenCalledWith('clerk_123');
    expect(deleteUserAccount).toHaveBeenCalledWith('internal-uuid');
    expect(syncUserFromClerk).not.toHaveBeenCalled();
  });

  it('returns 200 on user.deleted when user not found in DB (PF-840)', async () => {
    mockVerify.mockResolvedValue({
      type: 'user.deleted',
      data: { id: 'clerk_never_synced' },
    });
    vi.mocked(getUserByClerkId).mockResolvedValue(null);

    const req = new NextRequest('http://localhost/api/auth/webhook', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(getUserByClerkId).toHaveBeenCalledWith('clerk_never_synced');
    expect(deleteUserAccount).not.toHaveBeenCalled();
  });

  it('captures exception in Sentry when deleteUserAccount throws (PF-840)', async () => {
    const { captureException } = await import('@/lib/monitoring/sentry-server');
    mockVerify.mockResolvedValue({
      type: 'user.deleted',
      data: { id: 'clerk_123' },
    });
    vi.mocked(getUserByClerkId).mockResolvedValue({ id: 'internal-uuid', clerkId: 'clerk_123' } as never);
    vi.mocked(deleteUserAccount).mockRejectedValue(new Error('DB failure'));

    const req = new NextRequest('http://localhost/api/auth/webhook', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const res = await POST(req);

    expect(res.status).toBe(500);
    expect(captureException).toHaveBeenCalled();
  });

  it('rejects user.deleted event with missing id field (PF-840)', async () => {
    mockVerify.mockResolvedValue({
      type: 'user.deleted',
      data: {},
    });

    const req = new NextRequest('http://localhost/api/auth/webhook', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const res = await POST(req);

    expect(res.status).toBe(500);
    expect(deleteUserAccount).not.toHaveBeenCalled();
  });
});
