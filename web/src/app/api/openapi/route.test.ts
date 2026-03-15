vi.mock('server-only', () => ({}));

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockReadFileSync = vi.fn();

vi.mock('fs', () => ({
  readFileSync: mockReadFileSync,
  default: { readFileSync: mockReadFileSync },
}));

describe('GET /api/openapi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('should return OpenAPI spec as JSON', async () => {
    const mockSpec = { openapi: '3.0.0', info: { title: 'SpawnForge API', version: '1.0.0' } };
    mockReadFileSync.mockReturnValue(JSON.stringify(mockSpec));

    const { GET } = await import('./route');
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.openapi).toBe('3.0.0');
    expect(body.info.title).toBe('SpawnForge API');
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=3600');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('should return 500 when spec file not found', async () => {
    mockReadFileSync.mockImplementation(() => { throw new Error('ENOENT: no such file'); });

    const { GET } = await import('./route');
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toContain('ENOENT');
  });

  it('should return 500 when spec file has invalid JSON', async () => {
    mockReadFileSync.mockReturnValue('not valid json {{{');

    const { GET } = await import('./route');
    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBeDefined();
  });
});
