vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { POST } from './route';
import { NextRequest } from 'next/server';
import { syncUserFromClerk, getUserByClerkId, deleteUserAccount } from '@/lib/auth/user-service';

vi.mock('@/lib/auth/user-service');
vi.mock('@/lib/monitoring/sentry-server', () => ({
  captureException: vi.fn(),
}));

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

  it('syncs user on user.created event', async () => {
    mockVerify.mockResolvedValue({
      type: 'user.created',
      data: { id: 'clerk_123', email_addresses: [] },
    });

    const req = new NextRequest('http://localhost/api/auth/webhook', { 
      method: 'POST', 
      body: JSON.stringify({}) 
    });
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(syncUserFromClerk).toHaveBeenCalledWith({ id: 'clerk_123', email_addresses: [] });
  });

  it('syncs user on user.updated event', async () => {
    mockVerify.mockResolvedValue({
      type: 'user.updated',
      data: { id: 'clerk_123', email_addresses: [] },
    });

    const req = new NextRequest('http://localhost/api/auth/webhook', { 
      method: 'POST', 
      body: JSON.stringify({}) 
    });
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(syncUserFromClerk).toHaveBeenCalledWith({ id: 'clerk_123', email_addresses: [] });
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
