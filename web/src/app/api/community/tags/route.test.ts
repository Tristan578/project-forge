import { NextRequest } from 'next/server';
vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getDb } from '@/lib/db/client';

vi.mock('@/lib/db/client');
vi.mock('@/lib/db/schema', () => ({
  gameTags: { tag: 'tag' },
}));

describe('GET /api/community/tags', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return top tags by frequency', async () => {
    const tagsData = [
      { tag: 'puzzle', count: 15 },
      { tag: 'action', count: 10 },
      { tag: 'casual', count: 5 },
    ];

    const selectChain = {
      from: vi.fn().mockReturnThis(),
      groupBy: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue(tagsData),
    };
    const mockDb = {
      select: vi.fn().mockReturnValue(selectChain),
    };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { GET } = await import('./route');
    const res = await GET(new NextRequest('http://localhost/test'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.tags).toHaveLength(3);
    expect(body.tags[0]).toEqual({ tag: 'puzzle', count: 15 });
  });

  it('should return empty array when no tags exist', async () => {
    const selectChain = {
      from: vi.fn().mockReturnThis(),
      groupBy: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([]),
    };
    const mockDb = {
      select: vi.fn().mockReturnValue(selectChain),
    };
    vi.mocked(getDb).mockReturnValue(mockDb as never);

    const { GET } = await import('./route');
    const res = await GET(new NextRequest('http://localhost/test'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.tags).toEqual([]);
  });

  it('should return 500 on database error', async () => {
    vi.mocked(getDb).mockImplementation(() => { throw new Error('DB error'); });

    const { GET } = await import('./route');
    const res = await GET(new NextRequest('http://localhost/test'));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe('Failed to fetch tags');
  });
});
