// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { GET } from './route';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { discoverTool } from '@/lib/bridges/bridgeManager';
import type { BridgeToolConfig } from '@/lib/bridges/types';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/api-auth');
vi.mock('@/lib/bridges/bridgeManager');

const mockConfig: BridgeToolConfig = {
  id: 'aseprite',
  name: 'Aseprite',
  paths: { darwin: '/Applications/Aseprite.app', win32: 'C:\\Aseprite\\aseprite.exe' },
  activeVersion: '1.3.2',
  status: 'connected',
};

describe('GET /api/bridges/aseprite/status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: true as const,
      ctx: {
        clerkId: 'clerk_1',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        user: { id: 'user_1', tier: 'creator' } as any,
      },
    });
    vi.mocked(discoverTool).mockResolvedValue(mockConfig);
  });

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: false as const,
      response: new NextResponse('Unauthorized', { status: 401 }),
    });

    const res = await GET(new NextRequest('http://localhost/api/bridges/aseprite/status'));
    expect(res.status).toBe(401);
  });

  it('returns 200 with status and version on success', async () => {
    const res = await GET(new NextRequest('http://localhost/api/bridges/aseprite/status'));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('connected');
    expect(data.version).toBe('1.3.2');
    // Must not expose filesystem paths
    expect(data.paths).toBeUndefined();
    expect(data.id).toBeUndefined();
    expect(data.name).toBeUndefined();
  });

  it('returns disconnected status when aseprite not found', async () => {
    vi.mocked(discoverTool).mockResolvedValue({
      ...mockConfig,
      status: 'not_found',
      activeVersion: null,
    });

    const res = await GET(new NextRequest('http://localhost/api/bridges/aseprite/status'));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('not_found');
    expect(data.version).toBeNull();
  });

  it('returns 500 when discoverTool throws', async () => {
    vi.mocked(discoverTool).mockRejectedValue(new Error('Config file corrupted'));

    const res = await GET(new NextRequest('http://localhost/api/bridges/aseprite/status'));
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBe('Config file corrupted');
  });

  it('returns 500 with fallback message when error is not an Error instance', async () => {
    vi.mocked(discoverTool).mockRejectedValue(null);

    const res = await GET(new NextRequest('http://localhost/api/bridges/aseprite/status'));
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBe('Status check failed');
  });
});
