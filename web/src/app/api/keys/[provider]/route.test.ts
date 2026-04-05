vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { authenticateRequest, assertTier } from '@/lib/auth/api-auth';
import { rateLimit } from '@/lib/rateLimit';
import { storeProviderKey, deleteProviderKey } from '@/lib/keys/resolver';

vi.mock('@/lib/auth/api-auth');
vi.mock('@/lib/rateLimit', () => ({
  rateLimit: vi.fn(),
  rateLimitResponse: vi.fn(() => new Response('Rate limited', { status: 429 })),
}));
vi.mock('@/lib/keys/resolver');
import { NextRequest } from 'next/server';
vi.mock('@/lib/db/schema', () => ({
  // Provider type placeholder
}));

describe('PUT /api/keys/[provider]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: true as const,
      ctx: { clerkId: 'clerk_1', user: { id: 'user_1', tier: 'creator' } as never },
    });
    vi.mocked(rateLimit).mockResolvedValue({ allowed: true, remaining: 9, resetAt: Date.now() + 60000 });
    vi.mocked(assertTier).mockReturnValue(null);
    vi.mocked(storeProviderKey).mockResolvedValue(undefined);
  });

  it('should return 401 when not authenticated', async () => {
    const mockResponse = new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: false as const,
      response: mockResponse as never,
    });

    const { PUT } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/keys/anthropic', {
      method: 'PUT',
      body: JSON.stringify({ key: 'sk-test-key-12345678' }),
    });
    const res = await PUT(req, { params: Promise.resolve({ provider: 'anthropic' }) });

    expect(res.status).toBe(401);
  });

  it('should return 429 when rate limited', async () => {
    vi.mocked(rateLimit).mockResolvedValue({ allowed: false, remaining: 0, resetAt: Date.now() + 60000 });

    const { PUT } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/keys/anthropic', {
      method: 'PUT',
      body: JSON.stringify({ key: 'sk-test-key-12345678' }),
    });
    const res = await PUT(req, { params: Promise.resolve({ provider: 'anthropic' }) });

    expect(res.status).toBe(429);
  });

  it('should return 400 for invalid provider', async () => {
    const { PUT } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/keys/invalid', {
      method: 'PUT',
      body: JSON.stringify({ key: 'sk-test-key-12345678' }),
    });
    const res = await PUT(req, { params: Promise.resolve({ provider: 'invalid' }) });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain('must be one of');
  });

  it('should return 400 for short API key', async () => {
    const { PUT } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/keys/anthropic', {
      method: 'PUT',
      body: JSON.stringify({ key: 'short' }),
    });
    const res = await PUT(req, { params: Promise.resolve({ provider: 'anthropic' }) });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain('at least 8 character');
  });

  it('should store key and return success', async () => {
    const { PUT } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/keys/anthropic', {
      method: 'PUT',
      body: JSON.stringify({ key: 'sk-ant-api03-1234567890' }),
    });
    const res = await PUT(req, { params: Promise.resolve({ provider: 'anthropic' }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.provider).toBe('anthropic');
    expect(body.configured).toBe(true);
    expect(storeProviderKey).toHaveBeenCalled();
  });
});

describe('DELETE /api/keys/[provider]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: true as const,
      ctx: { clerkId: 'clerk_1', user: { id: 'user_1', tier: 'creator' } as never },
    });
    vi.mocked(rateLimit).mockResolvedValue({ allowed: true, remaining: 9, resetAt: Date.now() + 60000 });
    vi.mocked(deleteProviderKey).mockResolvedValue(undefined);
  });

  it('should return 401 when not authenticated', async () => {
    const mockResponse = new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: false as const,
      response: mockResponse as never,
    });

    const { DELETE } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/keys/anthropic', { method: 'DELETE' });
    const res = await DELETE(req, { params: Promise.resolve({ provider: 'anthropic' }) });

    expect(res.status).toBe(401);
  });

  it('should return 400 for invalid provider', async () => {
    const { DELETE } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/keys/invalid', { method: 'DELETE' });
    const res = await DELETE(req, { params: Promise.resolve({ provider: 'invalid' }) });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain('must be one of');
  });

  it('should delete key and return success', async () => {
    const { DELETE } = await import('./route');
    const req = new NextRequest('http://localhost:3000/api/keys/anthropic', { method: 'DELETE' });
    const res = await DELETE(req, { params: Promise.resolve({ provider: 'anthropic' }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.configured).toBe(false);
    expect(deleteProviderKey).toHaveBeenCalled();
  });
});
