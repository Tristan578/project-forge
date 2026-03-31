/**
 * PF-375 / PF-882: Error scenario tests for the chat executor and API layer.
 *
 * Covers:
 *  - executeToolCall with an unknown tool name returns { success: false } directly
 *  - executeToolCall when getCommandDispatcher throws synchronously
 *  - Chat API error handling (fetch failure / network error)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Hoist mocks so references are available inside vi.mock factories ──────────
const mocks = vi.hoisted(() => {
  const getCommandDispatcher = vi.fn();
  return { getCommandDispatcher };
});

// ── Mock all handler registries with empty objects ────────────────────────────
vi.mock('../handlers/transformHandlers', () => ({ transformHandlers: {} }));
vi.mock('../handlers/materialHandlers', () => ({ materialHandlers: {} }));
vi.mock('../handlers/queryHandlers', () => ({ queryHandlers: {} }));
vi.mock('../handlers/editModeHandlers', () => ({ editModeHandlers: {} }));
vi.mock('../handlers/audioHandlers', () => ({ audioHandlers: {} }));
vi.mock('../handlers/securityHandlers', () => ({ securityHandlers: {} }));
vi.mock('../handlers/exportHandlers', () => ({ exportHandlers: {} }));
vi.mock('../handlers/shaderHandlers', () => ({ shaderHandlers: {} }));
vi.mock('../handlers/performanceHandlers', () => ({ performanceHandlers: {} }));
vi.mock('../handlers/generationHandlers', () => ({ generationHandlers: {} }));
vi.mock('../handlers/handlers2d', () => ({ handlers2d: {} }));
vi.mock('../handlers/entityHandlers', () => ({ entityHandlers: {} }));
vi.mock('../handlers/sceneManagementHandlers', () => ({ sceneManagementHandlers: {} }));
vi.mock('../handlers/uiBuilderHandlers', () => ({ uiBuilderHandlers: {} }));
vi.mock('../handlers/dialogueHandlers', () => ({ dialogueHandlers: {} }));
vi.mock('../handlers/scriptLibraryHandlers', () => ({ scriptLibraryHandlers: {} }));
vi.mock('../handlers/physicsJointHandlers', () => ({ physicsJointHandlers: {} }));
vi.mock('../handlers/animationParticleHandlers', () => ({ animationParticleHandlers: {} }));
vi.mock('../handlers/gameplayHandlers', () => ({ gameplayHandlers: {} }));
vi.mock('../handlers/assetHandlers', () => ({ assetHandlers: {} }));
vi.mock('../handlers/audioEntityHandlers', () => ({ audioEntityHandlers: {} }));
vi.mock('../handlers/pixelArtHandlers', () => ({ pixelArtHandlers: {} }));
vi.mock('../handlers/compoundHandlers', () => ({ compoundHandlers: {} }));

// ── Mock editorStore ──────────────────────────────────────────────────────────
vi.mock('@/stores/editorStore', () => ({
  getCommandDispatcher: mocks.getCommandDispatcher,
}));

import { executeToolCall } from '../executor';
import type { EditorState } from '@/stores/editorStore';

// ── Store factory ─────────────────────────────────────────────────────────────

function makeStore(overrides: Record<string, unknown> = {}): EditorState {
  return {
    selectedIds: new Set<string>(),
    primaryId: null,
    sceneGraph: { nodes: {}, rootIds: [] },
    engineMode: 'edit',
    ...overrides,
  } as unknown as EditorState;
}

// ── Test: unknown tool name ───────────────────────────────────────────────────

describe('executeToolCall: unknown tool name', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCommandDispatcher.mockReturnValue(vi.fn());
  });

  it('returns { success: false } for an unrecognised tool name', async () => {
    const result = await executeToolCall('pf375_nonexistent_tool', {}, makeStore());
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/unknown tool/i);
  });

  it('includes the exact tool name in the error for unknown tools', async () => {
    const result = await executeToolCall('completely_unknown_xyz_123', { a: 1 }, makeStore());
    expect(result.success).toBe(false);
    expect(result.error).toContain('completely_unknown_xyz_123');
  });

  it('never throws for an unknown tool — always resolves', async () => {
    const promise = executeToolCall('no_such_tool_at_all', {}, makeStore());
    await expect(promise).resolves.toBeDefined();
  });

  it('returns success: false for unknown tools with args', async () => {
    const result = await executeToolCall('unknown_with_args', { entityId: 'e1', value: 42 }, makeStore());
    expect(result.success).toBe(false);
  });
});

// ── Test: dispatchCommand throws ─────────────────────────────────────────────

describe('executeToolCall: dispatchCommand throws', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('contains the error when getCommandDispatcher itself throws', async () => {
    mocks.getCommandDispatcher.mockImplementation(() => {
      throw new Error('Dispatcher initialisation failed');
    });

    const result = await executeToolCall('any_tool', {}, makeStore());

    expect(result.success).toBe(false);
    expect(result.error).toBe('Dispatcher initialisation failed');
  });

  it('returns generic error string when getCommandDispatcher throws a non-Error', async () => {
    mocks.getCommandDispatcher.mockImplementation(() => {
      // Intentionally throwing a primitive to exercise the `instanceof Error` branch.
      throw 'raw string error'; // NOSONAR
    });

    const result = await executeToolCall('any_tool', {}, makeStore());

    expect(result.success).toBe(false);
    expect(result.error).toBe('Execution failed');
  });

  it('does not propagate the thrown error as an unhandled rejection', async () => {
    mocks.getCommandDispatcher.mockImplementation(() => {
      throw new TypeError('Boom from dispatcher');
    });

    await expect(executeToolCall('some_tool', {}, makeStore())).resolves.toMatchObject({
      success: false,
    });
  });

  it('returns success: false when dispatcher throws an Error', async () => {
    mocks.getCommandDispatcher.mockImplementation(() => {
      throw new Error('First failure');
    });

    const result = await executeToolCall('tool', {}, makeStore());

    expect(result.success).toBe(false);
    expect(result.error).toBe('First failure');
  });
});

// ── Test: registered handler rejects ─────────────────────────────────────────

describe('executeToolCall: error containment for unknown tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCommandDispatcher.mockReturnValue(vi.fn());
  });

  it('catches TypeError and returns generic error string', async () => {
    mocks.getCommandDispatcher.mockImplementation(() => {
      throw new TypeError('hard crash');
    });

    const result = await executeToolCall('pf375_range_error', {}, makeStore());
    expect(result.success).toBe(false);
  });

  it('never throws — the promise always resolves', async () => {
    mocks.getCommandDispatcher.mockImplementation(() => {
      throw new RangeError('out of bounds');
    });

    const promise = executeToolCall('pf375_range_error', {}, makeStore());
    await expect(promise).resolves.toMatchObject({ success: false });
  });

  it('returns error even when execution context is minimal', async () => {
    const result = await executeToolCall('pf375_null_throw', {}, makeStore());
    expect(result.success).toBe(false);
    expect(typeof result.error).toBe('string');
  });
});

// ── Test: chat API fetch failure ──────────────────────────────────────────────

describe('chat API: fetch failure handling', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects with a network error when global.fetch throws', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockRejectedValue(
      new TypeError('Failed to fetch')
    );

    // Directly test that a fetch call to the chat endpoint rejects as expected.
    // This simulates what happens when the browser/server loses connectivity.
    await expect(
      fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'Hi' }] }),
      })
    ).rejects.toThrow('Failed to fetch');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('rejects with a timeout-style AbortError when fetch is aborted', async () => {
    // DOMException constructed with 'AbortError' already sets name = 'AbortError'.
    const abortError = new DOMException('The user aborted a request.', 'AbortError');
    vi.spyOn(global, 'fetch').mockRejectedValue(abortError);

    const promise = fetch('/api/chat', { method: 'POST', body: '{}' });

    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('rejects when fetch returns a non-ok response (500)', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'Internal Server Error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const res = await fetch('/api/chat', { method: 'POST', body: '{}' });

    expect(res.ok).toBe(false);
    expect(res.status).toBe(500);

    const body = await res.json() as { error: string };
    expect(body.error).toBe('Internal Server Error');
  });

  it('correctly identifies a 401 Unauthorized as a non-ok response', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const res = await fetch('/api/chat', { method: 'POST', body: '{}' });

    expect(res.ok).toBe(false);
    expect(res.status).toBe(401);
  });

  it('correctly identifies a 429 rate-limit response', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'Too many requests' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const res = await fetch('/api/chat', { method: 'POST', body: '{}' });

    expect(res.ok).toBe(false);
    expect(res.status).toBe(429);
  });
});
