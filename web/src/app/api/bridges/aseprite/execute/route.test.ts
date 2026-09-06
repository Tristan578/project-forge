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
  // Re-apply mocks after reset (vi.doMock is not hoisted, unlike vi.mock)
  vi.doMock('server-only', () => ({}));
  vi.doMock('@/lib/bridges/luaTemplates', () => ({
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

  it('never forwards stdout or stderr to the client, on either outcome', async () => {
    // The route used to `NextResponse.json(result)` verbatim, and a
    // BridgeResult carries `stdout`, `stderr` and `error: stderr || ...` —
    // which hold the child_process message: the full command line and the temp
    // Lua script path under the server's tmpdir. This is the success path of
    // the same egress class as #9736, and it is structurally invisible to
    // `spawnforge/no-raw-response-in-catch` (no catch, no construction it can
    // follow), so this assertion is the only thing holding it.
    const leaky: BridgeResult = {
      success: false,
      error: "aseprite: /var/folders/xy/T/spawnforge-bridge/ab12.lua:4: attempt to index a nil value",
      stdout: 'ERROR: sprite not found',
      stderr: "aseprite --batch --script /var/folders/xy/T/spawnforge-bridge/ab12.lua",
      exitCode: 1,
    };
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
      executeOperation: vi.fn().mockResolvedValue(leaky),
    }));

    const POST = await importRoute();
    const res = await POST(makeRequest({ operation: 'createSprite', params: { width: 32 } }));

    // Assert on the SERIALIZED body, not on parsed fields: a field renamed to
    // `details` would still carry the path while a field-by-field check passed.
    const raw = await res.text();
    expect(raw).not.toContain('spawnforge-bridge');
    expect(raw).not.toContain('.lua');
    expect(raw).not.toContain('--batch');
    expect(raw).not.toContain('stderr');
    expect(raw).not.toContain('stdout');
    expect(JSON.parse(raw)).toEqual({
      success: false,
      error: 'Aseprite operation failed. Check Sentry for details.',
    });
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
