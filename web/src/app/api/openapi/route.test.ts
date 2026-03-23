import { NextRequest } from 'next/server';
vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockReadFileSync = vi.fn();
const mockExistsSync = vi.fn();

vi.mock('fs', () => ({
  readFileSync: mockReadFileSync,
  existsSync: mockExistsSync,
  default: { readFileSync: mockReadFileSync, existsSync: mockExistsSync },
}));

vi.mock('@/lib/rateLimit', () => ({
  rateLimitPublicRoute: vi.fn().mockResolvedValue(null),
}));

describe('GET /api/openapi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    // Default: file exists and returns valid content
    mockExistsSync.mockReturnValue(true);
  });

  it('should return OpenAPI spec as JSON', async () => {
    const mockSpec = { openapi: '3.1.0', info: { title: 'SpawnForge API', version: '1.0.0' } };
    mockReadFileSync.mockReturnValue(JSON.stringify(mockSpec));

    const { GET } = await import('./route');
    const res = await GET(new NextRequest('http://localhost/test'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.openapi).toBe('3.1.0');
    expect(body.info.title).toBe('SpawnForge API');
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=3600');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('should return 404 when spec file does not exist', async () => {
    mockExistsSync.mockReturnValue(false);

    const { GET } = await import('./route');
    const res = await GET(new NextRequest('http://localhost/test'));
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBeTruthy();
  });

  it('should return 500 when spec file has invalid JSON', async () => {
    mockReadFileSync.mockReturnValue('not valid json {{{');

    const { GET } = await import('./route');
    const res = await GET(new NextRequest('http://localhost/test'));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBeDefined();
  });
});
