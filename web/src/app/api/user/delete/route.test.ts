import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './route';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { deleteUserAccount } from '@/lib/auth/user-service';
import { makeUser, mockNextResponse } from '@/test/utils/apiTestUtils';

vi.mock('@/lib/auth/api-auth');
vi.mock('@/lib/auth/user-service');

describe('POST /api/user/delete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 if unauthenticated', async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: false,
      response: mockNextResponse({ error: 'Unauthorized' }, { status: 401 }),
    });

    const res = await POST();
    expect(res.status).toBe(401);
  });

  it('deletes user account successfully', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user } });
    vi.mocked(deleteUserAccount).mockResolvedValue(undefined);

    const res = await POST();
    const data = await res.json();
    
    expect(res.status).toBe(200);
    expect(data.deleted).toBe(true);
    expect(deleteUserAccount).toHaveBeenCalledWith(user.id);
  });

  it('returns 500 if deletion fails', async () => {
    const user = makeUser();
    vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user } });
    vi.mocked(deleteUserAccount).mockRejectedValue(new Error('DB connection failed'));

    // Suppress console.error for this test
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await POST();
    const data = await res.json();
    
    expect(res.status).toBe(500);
    expect(data.error).toBe('Failed to delete account');
    
    consoleSpy.mockRestore();
  });
});
