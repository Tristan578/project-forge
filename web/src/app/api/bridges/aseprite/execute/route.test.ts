// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import type { BridgeToolConfig, BridgeResult } from '@/lib/bridges/types';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { dirname } from 'path';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/bridges/luaTemplates', () => ({
  ALLOWED_TEMPLATES: new Set(['createSprite', 'createAnimation', 'editSprite', 'applyPalette', 'exportSheet', 'drawFrames']),
}));

// Each test gets a fresh route module to avoid the module-level cache
async function importRoute() {
  vi.resetModules();
  // Re-apply mocks after reset (vi.doMock is not hoisted, unlike vi.mock)
  vi.doMock('server-only', () => ({}));
  vi.doMock('@/lib/bridges/luaTemplates', () => ({
    ALLOWED_TEMPLATES: new Set(['createSprite', 'createAnimation', 'editSprite', 'applyPalette', 'exportSheet', 'drawFrames']),
  }));
  const { POST } = await import('./route');
  return POST;
}

/**
 * The user-facing failure sentence, written once.
 *
 * It used to be "Aseprite operation failed. Check Sentry for details.", pinned
 * in three places, naming a next step the person on the other end cannot take —
 * Sentry is an internal developer tool they have no access to. This bridge runs
 * on the USER's own machine, so they are the only one who can fix it; the
 * sibling `status` route already said so and this one copied the old string.
 */
const BRIDGE_FAILURE_MESSAGE =
  'The Aseprite operation did not complete. Check that Aseprite is installed and the '
  + 'local bridge is running, then try again.';

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

/** Stand-in for a saved `.aseprite` file: arbitrary bytes, including non-UTF-8. */
const SPRITE_BYTES = Buffer.from([0xe0, 0xa5, 0x00, 0x00, 0xff, 0x46, 0x2d, 0x31, 0x30, 0x32, 0x37, 0x31]);

/**
 * An `executeOperation` that behaves like the real one on success: it writes
 * the sprite to the server-chosen `outputPath` the route handed it. Records
 * each path so a test can check the route removed the file afterwards.
 */
function savingExecute(bytes: Buffer = SPRITE_BYTES) {
  const paths: string[] = [];
  const fn = vi.fn(async (_binary: string, op: { params: Record<string, unknown> }) => {
    const out = String(op.params.outputPath);
    paths.push(out);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, bytes);
    return mockResult;
  });
  return { fn, paths };
}

function authed() {
  vi.doMock('@/lib/auth/api-auth', () => ({
    authenticateRequest: vi.fn().mockResolvedValue({
      ok: true as const,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ctx: { clerkId: 'clerk_1', user: { id: 'user_1', tier: 'creator' } as any },
    }),
  }));
}

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
    // Advertise exactly what this route runs. `drawFrames` is server-only and
    // the input-sprite templates are refused below, so naming them here would
    // invite a request that the very next check rejects (#10271).
    expect(data.error).toBe('Unknown operation: "maliciousScript". Allowed: createSprite, createAnimation');
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

  // #10271 board round 1: the route used to delete the server-chosen file in
  // `finally` before reading it, so a "successful" createSprite returned
  // nothing the caller could use. The bytes are the artifact; the path never is.
  it.each([['createSprite'], ['createAnimation']])(
    '%s returns the saved sprite bytes and removes the temp file',
    async (operation) => {
      authed();
      vi.doMock('@/lib/bridges/bridgeManager', () => ({
        discoverTool: vi.fn().mockResolvedValue(connectedConfig),
      }));
      const saving = savingExecute();
      vi.doMock('@/lib/bridges/asepriteBridge', () => ({ executeOperation: saving.fn }));

      const POST = await importRoute();
      const res = await POST(makeRequest({ operation, params: { width: 32, height: 32 } }));

      expect(res.status).toBe(200);
      const raw = await res.text();
      expect(JSON.parse(raw)).toEqual({
        success: true,
        sprite: {
          format: 'aseprite',
          contentType: 'application/octet-stream',
          base64: SPRITE_BYTES.toString('base64'),
        },
        metadata: { width: 32, height: 32 },
      });
      expect(Buffer.from(JSON.parse(raw).sprite.base64, 'base64').equals(SPRITE_BYTES)).toBe(true);
      // The server's path is not the caller's business, in any field.
      expect(saving.paths).toHaveLength(1);
      expect(raw).not.toContain('spawnforge-bridge');
      expect(raw).not.toContain('outputFiles');
      // And it is gone once the response exists.
      expect(existsSync(saving.paths[0])).toBe(false);
    },
  );

  it('returns the bridge failure, not an empty success, when Aseprite saved nothing', async () => {
    authed();
    vi.doMock('@/lib/bridges/bridgeManager', () => ({
      discoverTool: vi.fn().mockResolvedValue(connectedConfig),
    }));
    // Reports success but never writes outputPath.
    vi.doMock('@/lib/bridges/asepriteBridge', () => ({
      executeOperation: vi.fn().mockResolvedValue(mockResult),
    }));

    const POST = await importRoute();
    const res = await POST(makeRequest({ operation: 'createSprite', params: { width: 32, height: 32 } }));

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ success: false, error: BRIDGE_FAILURE_MESSAGE });
  });

  // #10271 board round 1: these three open an existing sprite with
  // `app.open("{{inputPath}}")`. The route refuses a client path and has no
  // server-owned input to give them, so they would run `app.open("")`. They
  // are refused up front, before discovery or any Aseprite run.
  it.each([['editSprite'], ['applyPalette'], ['exportSheet']])(
    'refuses %s, which needs an input sprite the route cannot supply',
    async (operation) => {
      authed();
      const discoverToolMock = vi.fn().mockResolvedValue(connectedConfig);
      vi.doMock('@/lib/bridges/bridgeManager', () => ({ discoverTool: discoverToolMock }));
      const executeOperationMock = vi.fn().mockResolvedValue(mockResult);
      vi.doMock('@/lib/bridges/asepriteBridge', () => ({ executeOperation: executeOperationMock }));

      const POST = await importRoute();
      const res = await POST(makeRequest({ operation, params: { width: 16 } }));

      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe(
        `Operation "${operation}" requires an input sprite, which this route cannot accept yet. `
        + 'Allowed: createSprite, createAnimation',
      );
      expect(discoverToolMock).not.toHaveBeenCalled();
      expect(executeOperationMock).not.toHaveBeenCalled();
    },
  );

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
      error: BRIDGE_FAILURE_MESSAGE,
    });
  });

  it('accepts null params and defaults to empty object', async () => {
    const nullParamsMock = savingExecute().fn;
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
      expect.objectContaining({
        name: 'createSprite',
        // The only param is the server's own output path (#10271).
        params: { outputPath: expect.stringMatching(/spawnforge-bridge\/[0-9a-f-]+\.aseprite$/) },
      })
    );
  });

  it('accepts missing params and defaults to empty object', async () => {
    const executeOperationMock = savingExecute().fn;
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
      expect.objectContaining({
        name: 'createSprite',
        // The only param is the server's own output path (#10271).
        params: { outputPath: expect.stringMatching(/spawnforge-bridge\/[0-9a-f-]+\.aseprite$/) },
      })
    );
  });

  // #10271: templates hand these to saveAs / app.open. A client choosing them
  // chose where the server writes and what it opens.
  it.each([['outputPath'], ['inputPath'], ['outputPng'], ['outputJson']])(
    'rejects a client-supplied %s before touching Aseprite',
    async (key) => {
      const executeOperationMock = vi.fn().mockResolvedValue(mockResult);
      vi.doMock('@/lib/auth/api-auth', () => ({
        authenticateRequest: vi.fn().mockResolvedValue({
          ok: true as const,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ctx: { clerkId: 'clerk_1', user: { id: 'user_1', tier: 'creator' } as any },
        }),
      }));
      const discoverToolMock = vi.fn().mockResolvedValue(connectedConfig);
      vi.doMock('@/lib/bridges/bridgeManager', () => ({ discoverTool: discoverToolMock }));
      vi.doMock('@/lib/bridges/asepriteBridge', () => ({ executeOperation: executeOperationMock }));

      const POST = await importRoute();
      const res = await POST(
        makeRequest({ operation: 'createSprite', params: { width: 16, [key]: 'C:/Windows/evil.aseprite' } }),
      );

      expect(res.status).toBe(400);
      expect((await res.json()).error).toContain(key);
      expect(executeOperationMock).not.toHaveBeenCalled();
    },
  );

  it('does not run the server-only drawFrames template for a client', async () => {
    const executeOperationMock = vi.fn().mockResolvedValue(mockResult);
    vi.doMock('@/lib/auth/api-auth', () => ({
      authenticateRequest: vi.fn().mockResolvedValue({
        ok: true as const,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ctx: { clerkId: 'clerk_1', user: { id: 'user_1', tier: 'creator' } as any },
      }),
    }));
    vi.doMock('@/lib/bridges/bridgeManager', () => ({ discoverTool: vi.fn().mockResolvedValue(connectedConfig) }));
    vi.doMock('@/lib/bridges/asepriteBridge', () => ({ executeOperation: executeOperationMock }));

    const POST = await importRoute();
    const res = await POST(makeRequest({ operation: 'drawFrames', params: {} }));

    expect(res.status).toBe(400);
    expect(executeOperationMock).not.toHaveBeenCalled();
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
    expect(data.error).toBe(BRIDGE_FAILURE_MESSAGE);
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
    expect(data.error).toBe(BRIDGE_FAILURE_MESSAGE);
  });
});
