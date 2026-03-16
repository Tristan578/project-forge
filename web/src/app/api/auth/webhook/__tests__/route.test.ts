/**
 * Unit tests for the Clerk auth webhook POST handler.
 */

vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockVerify, mockSyncUserFromClerk, mockSoftDeleteUser } = vi.hoisted(() => ({
  mockVerify: vi.fn(),
  mockSyncUserFromClerk: vi.fn(() => Promise.resolve({ id: 'user-1' })),
  mockSoftDeleteUser: vi.fn(() => Promise.resolve()),
}));

vi.mock('svix', () => {
  return {
    Webhook: class MockWebhook {
      verify = mockVerify;
    },
  };
});

vi.mock('next/headers', () => ({
  headers: vi.fn(() =>
    Promise.resolve({
      get: (name: string) => {
        const map: Record<string, string> = {
          'svix-id': 'msg_test123',
          'svix-timestamp': '1234567890',
          'svix-signature': 'v1,test-signature',
        };
        return map[name] ?? null;
      },
    })
  ),
}));

vi.mock('@/lib/auth/user-service', () => ({
  syncUserFromClerk: mockSyncUserFromClerk,
  softDeleteUser: mockSoftDeleteUser,
}));

import { POST } from '../route';

function makeRequest(body: unknown): Request {
  return new Request('https://example.com/api/auth/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makeClerkEvent(type: string, data: Record<string, unknown> = {}) {
  return { type, data };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CLERK_WEBHOOK_SECRET = 'whsec_test';
});

describe('POST /api/auth/webhook', () => {
  it('returns 500 when CLERK_WEBHOOK_SECRET is not set', async () => {
    delete process.env.CLERK_WEBHOOK_SECRET;
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toContain('Webhook secret not configured');
  });

  it('returns 400 when svix headers are missing', async () => {
    const { headers: headersMock } = await import('next/headers');
    (headersMock as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      get: () => null,
    });
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('Missing svix headers');
  });

  it('returns 400 when signature verification fails', async () => {
    mockVerify.mockImplementationOnce(() => { throw new Error('Invalid signature'); });
    const res = await POST(makeRequest({ type: 'user.created', data: {} }));
    expect(res.status).toBe(400);
  });

  it('calls syncUserFromClerk for user.created events', async () => {
    const event = makeClerkEvent('user.created', {
      id: 'clerk_abc',
      email_addresses: [{ email_address: 'test@example.com' }],
      first_name: 'Alice',
    });
    mockVerify.mockReturnValueOnce(event);
    const res = await POST(makeRequest(event));
    expect(res.status).toBe(200);
    expect(mockSyncUserFromClerk).toHaveBeenCalledOnce();
    expect(mockSyncUserFromClerk).toHaveBeenCalledWith(event.data);
  });

  it('calls syncUserFromClerk for user.updated events', async () => {
    const event = makeClerkEvent('user.updated', {
      id: 'clerk_abc',
      email_addresses: [{ email_address: 'updated@example.com' }],
    });
    mockVerify.mockReturnValueOnce(event);
    const res = await POST(makeRequest(event));
    expect(res.status).toBe(200);
    expect(mockSyncUserFromClerk).toHaveBeenCalledOnce();
  });

  it('calls softDeleteUser for user.deleted events', async () => {
    const event = makeClerkEvent('user.deleted', { id: 'clerk_deleted_user' });
    mockVerify.mockReturnValueOnce(event);
    const res = await POST(makeRequest(event));
    expect(res.status).toBe(200);
    expect(mockSoftDeleteUser).toHaveBeenCalledOnce();
    expect(mockSoftDeleteUser).toHaveBeenCalledWith('clerk_deleted_user');
  });

  it('does not call softDeleteUser when user.deleted has no id', async () => {
    const event = makeClerkEvent('user.deleted', {});
    mockVerify.mockReturnValueOnce(event);
    const res = await POST(makeRequest(event));
    expect(res.status).toBe(200);
    expect(mockSoftDeleteUser).not.toHaveBeenCalled();
  });

  it('does not call softDeleteUser when id is not a string', async () => {
    const event = makeClerkEvent('user.deleted', { id: 12345 });
    mockVerify.mockReturnValueOnce(event);
    const res = await POST(makeRequest(event));
    expect(res.status).toBe(200);
    expect(mockSoftDeleteUser).not.toHaveBeenCalled();
  });

  it('returns 200 for unknown event types without calling any handlers', async () => {
    const event = makeClerkEvent('session.revoked', { id: 'sess_123' });
    mockVerify.mockReturnValueOnce(event);
    const res = await POST(makeRequest(event));
    expect(res.status).toBe(200);
    expect(mockSyncUserFromClerk).not.toHaveBeenCalled();
    expect(mockSoftDeleteUser).not.toHaveBeenCalled();
  });

  it('returns received: true on success', async () => {
    const event = makeClerkEvent('user.created', {
      id: 'clerk_abc',
      email_addresses: [{ email_address: 'test@example.com' }],
    });
    mockVerify.mockReturnValueOnce(event);
    const res = await POST(makeRequest(event));
    const json = await res.json();
    expect(json.received).toBe(true);
  });
});
