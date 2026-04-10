// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import type { BridgeToolConfig, BridgeResult } from '@/lib/bridges/types';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/bridges/luaTemplates', () => ({
  ALLOWED_TEMPLATES: new Set(['createSprite', 'createAnimation', 'editSprite', 'applyPalette', 'exportSheet']),
}));

// Each test gets a fresh route module to avoid the module-level cache
async function importRoute() {
  vi.resetModules();
  // Re-apply mocks after reset
  vi.mock('server-only', () => ({}));
  vi.mock('@/lib/bridges/luaTemplates', () => ({
    ALLOWED_TEMPLATES: new Set(['createSprite', 'createAnimation', 'editSprite', 'applyPalette', 'exportSheet']),
  }));
  const { POST } = await import('./route');
  return POST;
}

const connectedConfig: BridgeToolConfig = {
  id: 'aseprite',
  name: 'Aseprite',
  paths: { darwin: '/Applications/Aseprite.app', win32: 'C:\\Aseprite\\aseprite.exe', linux: '/usr/bin/aseprite' },
  activeVersion: '1.3.2',
  status: 'connected',
};

const mockResult: BridgeResult = {
  success: true,
  outputFiles: ['/tmp/output.png'],
  metadata: { width: 32, height: 32 },
};

function makeRequest(body: unknown) {
  return new NextRequest('http://test/api/bridges/aseprite/execute', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

describe('POST /api/bridges/aseprite/execute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    vi.doMock('@/lib/auth/api-auth', () => ({
      authenticateRequest: vi.fn().mockResolvedValue({
        ok: false as const,
        response: new NextResponse('Unauthorized', { status: 401 }),
      }),
    }));
    vi.doMock('@/lib/bridges/bridgeManager', () => ({
      discoverTool: vi.fn().mockResolvedValue(connectedConfig),
      isAllowedToolId: vi.fn().mockReturnValue(true),
    }));
    vi.doMock('@/lib/bridges/asepriteBridge', () => ({
      executeOperation: vi.fn().mockResolvedValue(mockResult),
    }));

    const POST = await importRoute();
    const res = await POST(makeRequest({ operation: 'createSprite', params: { width: 32, height: 32 } }));
    expect(res.status).toBe(401);
  });

  it('returns 422 when operation is missing', async () => {
    vi.doMock('@/lib/auth/api-auth', () => ({
      authenticateRequest: vi.fn().mockResolvedValue({
        ok: true as const,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ctx: { clerkId: 'clerk_1', user: { id: 'user_1', tier: 'creator' } as any },
      }),
    }));
    vi.doMock('@/lib/bridges/bridgeManager', () => ({
      discoverTool: vi.fn().mockResolvedValue(connectedConfig),
    }));
    vi.doMock('@/lib/bridges/asepriteBridge', () => ({
      executeOperation: vi.fn().mockResolvedValue(mockResult),
    }));

    const POST = await importRoute();
    const res = await POST(makeRequest({ params: { width: 32 } }));
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.error).toBe('Validation failed');
  });

  it('returns 422 when operation is not a string', async () => {
    vi.doMock('@/lib/auth/api-auth', () => ({
      authenticateRequest: vi.fn().mockResolvedValue({
        ok: true as const,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ctx: { clerkId: 'clerk_1', user: { id: 'user_1', tier: 'creator' } as any },
      }),
    }));
    vi.doMock('@/lib/bridges/bridgeManager', () => ({
      discoverTool: vi.fn().mockResolvedValue(connectedConfig),
    }));
    vi.doMock('@/lib/bridges/asepriteBridge', () => ({
      executeOperation: vi.fn().mockResolvedValue(mockResult),
    }));

    const POST = await importRoute();
    const res = await POST(makeRequest({ operation: 123 }));
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.error).toBe('Validation failed');
  });

  it('returns 400 when operation is not in allowlist', async () => {
    vi.doMock('@/lib/auth/api-auth', () => ({
      authenticateRequest: vi.fn().mockResolvedValue({
        ok: true as const,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ctx: { clerkId: 'clerk_1', user: { id: 'user_1', tier: 'creator' } as any },
      }),
    }));
    vi.doMock('@/lib/bridges/bridgeManager', () => ({
      discoverTool: vi.fn().mockResolvedValue(connectedConfig),
    }));
    vi.doMock('@/lib/bridges/asepriteBridge', () => ({
      executeOperation: vi.fn().mockResolvedValue(mockResult),
    }));

    const POST = await importRoute();
    const res = await POST(makeRequest({ operation: 'maliciousScript' }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('Unknown operation');
    expect(data.error).toContain('maliciousScript');
    expect(data.error).toContain('createSprite');
  });

  it('returns 422 when params is an array', async () => {
    vi.doMock('@/lib/auth/api-auth', () => ({
      authenticateRequest: vi.fn().mockResolvedValue({
        ok: true as const,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ctx: { clerkId: 'clerk_1', user: { id: 'user_1', tier: 'creator' } as any },
      }),
    }));
    vi.doMock('@/lib/bridges/bridgeManager', () => ({
      discoverTool: vi.fn().mockResolvedValue(connectedConfig),
    }));
    vi.doMock('@/lib/bridges/asepriteBridge', () => ({
      executeOperation: vi.fn().mockResolvedValue(mockResult),
    }));

    const POST = await importRoute();
    const res = await POST(makeRequest({ operation: 'createSprite', params: [1, 2, 3] }));
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.error).toBe('Validation failed');
  });

  it('returns 422 when params is a primitive', async () => {
    vi.doMock('@/lib/auth/api-auth', () => ({
      authenticateRequest: vi.fn().mockResolvedValue({
        ok: true as const,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ctx: { clerkId: 'clerk_1', user: { id: 'user_1', tier: 'creator' } as any },
      }),
    }));
    vi.doMock('@/lib/bridges/bridgeManager', () => ({
      discoverTool: vi.fn().mockResolvedValue(connectedConfig),
    }));
    vi.doMock('@/lib/bridges/asepriteBridge', () => ({
      executeOperation: vi.fn().mockResolvedValue(mockResult),
    }));

    const POST = await importRoute();
    const res = await POST(makeRequest({ operation: 'createSprite', params: 'bad' }));
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.error).toBe('Validation failed');
  });

  it('returns 503 when aseprite is not connected', async () => {
    vi.doMock('@/lib/auth/api-auth', () => ({
      authenticateRequest: vi.fn().mockResolvedValue({
        ok: true as const,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ctx: { clerkId: 'clerk_1', user: { id: 'user_1', tier: 'creator' } as any },
      }),
    }));
    vi.doMock('@/lib/bridges/bridgeManager', () => ({
      discoverTool: vi.fn().mockResolvedValue({ ...connectedConfig, status: 'not_found' }),
    }));
    vi.doMock('@/lib/bridges/asepriteBridge', () => ({
      executeOperation: vi.fn().mockResolvedValue(mockResult),
    }));

    const POST = await importRoute();
    const res = await POST(makeRequest({ operation: 'createSprite', params: { width: 32, height: 32 } }));
    expect(res.status).toBe(503);
    const data = await res.json();
    expect(data.error).toContain('Aseprite not available');
    expect(data.error).toContain('not_found');
  });

  it('returns 503 when no binary path for current platform', async () => {
    vi.doMock('@/lib/auth/api-auth', () => ({
      authenticateRequest: vi.fn().mockResolvedValue({
        ok: true as const,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ctx: { clerkId: 'clerk_1', user: { id: 'user_1', tier: 'creator' } as any },
      }),
    }));
    vi.doMock('@/lib/bridges/bridgeManager', () => ({
      discoverTool: vi.fn().mockResolvedValue({ ...connectedConfig, paths: {} }),
    }));
    vi.doMock('@/lib/bridges/asepriteBridge', () => ({
      executeOperation: vi.fn().mockResolvedValue(mockResult),
    }));

    const POST = await importRoute();
    const res = await POST(makeRequest({ operation: 'createSprite', params: { width: 32, height: 32 } }));
    expect(res.status).toBe(503);
    const data = await res.json();
    expect(data.error).toBe('No Aseprite binary path for current platform');
  });

  it('returns 200 with result on successful execution', async () => {
    vi.doMock('@/lib/auth/api-auth', () => ({
      authenticateRequest: vi.fn().mockResolvedValue({
        ok: true as const,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ctx: { clerkId: 'clerk_1', user: { id: 'user_1', tier: 'creator' } as any },
      }),
    }));
    vi.doMock('@/lib/bridges/bridgeManager', () => ({
      discoverTool: vi.fn().mockResolvedValue(connectedConfig),
    }));
    vi.doMock('@/lib/bridges/asepriteBridge', () => ({
      executeOperation: vi.fn().mockResolvedValue(mockResult),
    }));

    const POST = await importRoute();
    const res = await POST(makeRequest({ operation: 'createSprite', params: { width: 32, height: 32 } }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.outputFiles).toEqual(['/tmp/output.png']);
    expect(data.metadata).toEqual({ width: 32, height: 32 });
  });

  it('accepts null params and defaults to empty object', async () => {
    const nullParamsMock = vi.fn().mockResolvedValue(mockResult);
    vi.doMock('@/lib/auth/api-auth', () => ({
      authenticateRequest: vi.fn().mockResolvedValue({
        ok: true as const,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ctx: { clerkId: 'clerk_1', user: { id: 'user_1', tier: 'creator' } as any },
      }),
    }));
    vi.doMock('@/lib/bridges/bridgeManager', () => ({
      discoverTool: vi.fn().mockResolvedValue(connectedConfig),
    }));
    vi.doMock('@/lib/bridges/asepriteBridge', () => ({
      executeOperation: nullParamsMock,
    }));

    const POST = await importRoute();
    const res = await POST(makeRequest({ operation: 'createSprite', params: null }));
    expect(res.status).toBe(200);
    expect(nullParamsMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ name: 'createSprite', params: {} })
    );
  });

  it('accepts missing params and defaults to empty object', async () => {
    const executeOperationMock = vi.fn().mockResolvedValue(mockResult);
    vi.doMock('@/lib/auth/api-auth', () => ({
      authenticateRequest: vi.fn().mockResolvedValue({
        ok: true as const,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ctx: { clerkId: 'clerk_1', user: { id: 'user_1', tier: 'creator' } as any },
      }),
    }));
    vi.doMock('@/lib/bridges/bridgeManager', () => ({
      discoverTool: vi.fn().mockResolvedValue(connectedConfig),
    }));
    vi.doMock('@/lib/bridges/asepriteBridge', () => ({
      executeOperation: executeOperationMock,
    }));

    const POST = await importRoute();
    const res = await POST(makeRequest({ operation: 'createSprite' }));
    expect(res.status).toBe(200);
    expect(executeOperationMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ name: 'createSprite', params: {} })
    );
  });

  it('returns 500 when executeOperation throws', async () => {
    vi.doMock('@/lib/auth/api-auth', () => ({
      authenticateRequest: vi.fn().mockResolvedValue({
        ok: true as const,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ctx: { clerkId: 'clerk_1', user: { id: 'user_1', tier: 'creator' } as any },
      }),
    }));
    vi.doMock('@/lib/bridges/bridgeManager', () => ({
      discoverTool: vi.fn().mockResolvedValue(connectedConfig),
    }));
    vi.doMock('@/lib/bridges/asepriteBridge', () => ({
      executeOperation: vi.fn().mockRejectedValue(new Error('Aseprite process crashed')),
    }));

    const POST = await importRoute();
    const res = await POST(makeRequest({ operation: 'createSprite', params: { width: 32, height: 32 } }));
    expect(res.status).toBe(500);
    const data = await res.json();
    // Route returns generic error message (not err.message) to prevent internal info leakage
    expect(data.error).toBe('Aseprite operation failed. Check Sentry for details.');
  });

  it('returns 500 with fallback message when error is not an Error instance', async () => {
    vi.doMock('@/lib/auth/api-auth', () => ({
      authenticateRequest: vi.fn().mockResolvedValue({
        ok: true as const,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ctx: { clerkId: 'clerk_1', user: { id: 'user_1', tier: 'creator' } as any },
      }),
    }));
    vi.doMock('@/lib/bridges/bridgeManager', () => ({
      discoverTool: vi.fn().mockResolvedValue(connectedConfig),
    }));
    vi.doMock('@/lib/bridges/asepriteBridge', () => ({
      executeOperation: vi.fn().mockRejectedValue('unknown failure'),
    }));

    const POST = await importRoute();
    const res = await POST(makeRequest({ operation: 'createSprite', params: { width: 32, height: 32 } }));
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBe('Aseprite operation failed. Check Sentry for details.');
  });
});
