import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { POST } from './route';
import { syncUserFromClerk } from '@/lib/auth/user-service';

vi.mock('@/lib/auth/user-service');

const mockVerify = vi.fn();
vi.mock('svix', () => ({
  Webhook: class {
    verify = mockVerify;
  },
}));

vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue(new Map([
    ['svix-id', 'svix_id_mock'],
    ['svix-timestamp', 'svix_timestamp_mock'],
    ['svix-signature', 'svix_signature_mock'],
  ])),
}));

describe('POST /api/auth/webhook', () => {
  const env = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CLERK_WEBHOOK_SECRET = 'whsec_mock';
  });

  afterEach(() => {
    process.env = env;
  });

  it('returns 500 if WEBHOOK_SECRET is missing', async () => {
    delete process.env.CLERK_WEBHOOK_SECRET;
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

  it('ignores other event types but returns 200', async () => {
    mockVerify.mockReturnValue({
      type: 'user.deleted',
      data: { id: 'clerk_123' },
    });

    const req = new Request('http://localhost/api/auth/webhook', { 
      method: 'POST', 
      body: JSON.stringify({}) 
    });
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(syncUserFromClerk).not.toHaveBeenCalled();
  });
});
