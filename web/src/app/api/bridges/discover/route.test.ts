// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { POST } from './route';
import { authenticateRequest } from '@/lib/auth/api-auth';
import { discoverTool, isAllowedToolId } from '@/lib/bridges/bridgeManager';
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

function makeRequest(body: unknown) {
  return new NextRequest('http://test/api/bridges/discover', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

describe('POST /api/bridges/discover', () => {
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
    vi.mocked(isAllowedToolId).mockReturnValue(true);
    vi.mocked(discoverTool).mockResolvedValue(mockConfig);
  });

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(authenticateRequest).mockResolvedValue({
      ok: false as const,
      response: new NextResponse('Unauthorized', { status: 401 }),
    });

    const res = await POST(makeRequest({ toolId: 'aseprite' }));
    expect(res.status).toBe(401);
  });

  it('returns 422 when toolId is missing', async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.error).toBe('Validation failed');
    expect(data.code).toBe('VALIDATION_ERROR');
  });

  it('returns 422 when toolId is not a string', async () => {
    const res = await POST(makeRequest({ toolId: 42 }));
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.error).toBe('Validation failed');
    expect(data.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when toolId is an unknown tool', async () => {
    vi.mocked(isAllowedToolId).mockReturnValue(false);

    const res = await POST(makeRequest({ toolId: 'unknown-tool' }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('Unknown tool');
    expect(data.error).toContain('unknown-tool');
  });

  it('returns 200 with stripped config on success', async () => {
    const res = await POST(makeRequest({ toolId: 'aseprite' }));
    expect(res.status).toBe(200);
    const data = await res.json();
    // Only id, name, status, activeVersion — no filesystem paths
    expect(data.id).toBe('aseprite');
    expect(data.name).toBe('Aseprite');
    expect(data.status).toBe('connected');
    expect(data.activeVersion).toBe('1.3.2');
    expect(data.paths).toBeUndefined();
  });

  it('returns 500 when discoverTool throws', async () => {
    vi.mocked(discoverTool).mockRejectedValue(new Error('Bridge config read failed'));

    const res = await POST(makeRequest({ toolId: 'aseprite' }));
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBe('Bridge config read failed');
  });

  it('returns 500 with fallback message when error is not an Error instance', async () => {
    vi.mocked(discoverTool).mockRejectedValue('string error');

    const res = await POST(makeRequest({ toolId: 'aseprite' }));
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBe('Discovery failed');
  });
});
