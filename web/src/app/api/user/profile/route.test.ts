import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET, PUT } from './route';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { updateDisplayName } from '@/lib/auth/user-service';
import { makeUser, mockNextResponse } from '@/test/utils/apiTestUtils';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth/api-auth');
vi.mock('@/lib/auth/user-service');

describe('/api/user/profile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET', () => {
    it('returns 401 if unauthenticated', async () => {
      vi.mocked(authenticateRequest).mockResolvedValue({
        ok: false,
        response: mockNextResponse({ error: 'Unauthorized' }, { status: 401 }),
      });

      const res = await GET();
      expect(res.status).toBe(401);
    });

    it('returns user profile data', async () => {
      const user = makeUser({
        displayName: 'Test Profile',
        email: 'profile@example.com',
        tier: 'creator',
      });
      vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user } });

      const res = await GET();
      const data = await res.json();
      
      expect(res.status).toBe(200);
      expect(data.displayName).toBe('Test Profile');
      expect(data.email).toBe('profile@example.com');
      expect(data.tier).toBe('creator');
      expect(data.createdAt).toBeDefined();
    });
  });

  describe('PUT', () => {
    it('returns 401 if unauthenticated', async () => {
      vi.mocked(authenticateRequest).mockResolvedValue({
        ok: false,
        response: mockNextResponse({ error: 'Unauthorized' }, { status: 401 }),
      });

      const req = new NextRequest('http://localhost/api/user/profile', { 
        method: 'PUT',
        body: JSON.stringify({ displayName: 'New Name' }),
      });
      const res = await PUT(req);
      expect(res.status).toBe(401);
    });

    it('returns 400 for invalid JSON body', async () => {
      vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user: makeUser() } });

      const req = new NextRequest('http://localhost/api/user/profile', { 
        method: 'PUT',
        body: 'invalid-json',
      });
      const res = await PUT(req);
      const data = await res.json();
      expect(res.status).toBe(400);
      expect(data.error).toBe('Invalid JSON body');
    });

    it('returns 400 if displayName is missing', async () => {
      vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user: makeUser() } });

      const req = new NextRequest('http://localhost/api/user/profile', { 
        method: 'PUT',
        body: JSON.stringify({}),
      });
      const res = await PUT(req);
      expect(res.status).toBe(400);
    });

    it('updates display name successfully', async () => {
      const user = makeUser();
      vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user } });
      
      const updatedUser = { ...user, displayName: 'Updated Name' };
      vi.mocked(updateDisplayName).mockResolvedValue(updatedUser as Awaited<ReturnType<typeof updateDisplayName>>);

      const req = new NextRequest('http://localhost/api/user/profile', { 
        method: 'PUT',
        body: JSON.stringify({ displayName: 'Updated Name' }),
      });
      const res = await PUT(req);
      const data = await res.json();
      
      expect(res.status).toBe(200);
      expect(data.displayName).toBe('Updated Name');
      expect(updateDisplayName).toHaveBeenCalledWith(user.id, 'Updated Name');
    });

    it('returns 400 if updateDisplayName throws', async () => {
      vi.mocked(authenticateRequest).mockResolvedValue({ ok: true, ctx: { clerkId: '123', user: makeUser() } });
      vi.mocked(updateDisplayName).mockRejectedValue(new Error('Validation failed'));

      const req = new NextRequest('http://localhost/api/user/profile', {
        method: 'PUT',
        body: JSON.stringify({ displayName: 'a' }), // too short — now caught by requireString
      });
      const res = await PUT(req);
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.error).toContain('at least 2 character');
    });
  });
});
