vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { POST } from './route';
import { syncUserFromClerk, getUserByClerkId, deleteUserAccount } from '@/lib/auth/user-service';

vi.mock('@/lib/auth/user-service');
vi.mock('@/lib/monitoring/sentry-server', () => ({
  captureException: vi.fn(),
}));

const mockVerify = vi.fn();
vi.mock('svix', () => ({
  Webhook: class {
    verify = mockVerify;
  },
}));

vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue(new Headers({
    'svix-id': 'svix_id_mock',
    'svix-timestamp': 'svix_timestamp_mock',
    'svix-signature': 'svix_signature_mock',
  })),
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
    const req = new Request('http://localhost/api/auth/webhook', { method: 'POST' });
    const res = await POST(req);
    expect(res.status).toBe(500);
  });

  it('returns 400 if svix headers are missing', async () => {
    vi.mocked(await import('next/headers')).headers.mockResolvedValueOnce(new Headers());
    const req = new Request('http://localhost/api/auth/webhook', { method: 'POST' });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 if signature is invalid', async () => {
    mockVerify.mockImplementation(() => { throw new Error('Invalid signature'); });
    const req = new Request('http://localhost/api/auth/webhook', { 
      method: 'POST', 
      body: JSON.stringify({ type: 'user.created' }) 
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('syncs user on user.created event', async () => {
    mockVerify.mockReturnValue({
      type: 'user.created',
      data: { id: 'clerk_123', email_addresses: [] },
    });

    const req = new Request('http://localhost/api/auth/webhook', { 
      method: 'POST', 
      body: JSON.stringify({}) 
    });
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(syncUserFromClerk).toHaveBeenCalledWith({ id: 'clerk_123', email_addresses: [] });
  });

  it('syncs user on user.updated event', async () => {
    mockVerify.mockReturnValue({
      type: 'user.updated',
      data: { id: 'clerk_123', email_addresses: [] },
    });

    const req = new Request('http://localhost/api/auth/webhook', { 
      method: 'POST', 
      body: JSON.stringify({}) 
    });
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(syncUserFromClerk).toHaveBeenCalledWith({ id: 'clerk_123', email_addresses: [] });
  });

  // PF-840 regression: user.deleted must cascade-delete user data, not be ignored.
  it('deletes user data on user.deleted event when user exists (PF-840)', async () => {
    mockVerify.mockReturnValue({
      type: 'user.deleted',
      data: { id: 'clerk_123' },
    });
    vi.mocked(getUserByClerkId).mockResolvedValue({ id: 'internal-uuid', clerkId: 'clerk_123' } as never);
    vi.mocked(deleteUserAccount).mockResolvedValue(undefined);

    const req = new Request('http://localhost/api/auth/webhook', {
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
    mockVerify.mockReturnValue({
      type: 'user.deleted',
      data: { id: 'clerk_never_synced' },
    });
    vi.mocked(getUserByClerkId).mockResolvedValue(null);

    const req = new Request('http://localhost/api/auth/webhook', {
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
    mockVerify.mockReturnValue({
      type: 'user.deleted',
      data: { id: 'clerk_123' },
    });
    vi.mocked(getUserByClerkId).mockResolvedValue({ id: 'internal-uuid', clerkId: 'clerk_123' } as never);
    vi.mocked(deleteUserAccount).mockRejectedValue(new Error('DB failure'));

    const req = new Request('http://localhost/api/auth/webhook', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const res = await POST(req);

    expect(res.status).toBe(500);
    expect(captureException).toHaveBeenCalled();
  });

  it('rejects user.deleted event with missing id field (PF-840)', async () => {
    mockVerify.mockReturnValue({
      type: 'user.deleted',
      data: {},
    });

    const req = new Request('http://localhost/api/auth/webhook', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const res = await POST(req);

    expect(res.status).toBe(500);
    expect(deleteUserAccount).not.toHaveBeenCalled();
  });
});
