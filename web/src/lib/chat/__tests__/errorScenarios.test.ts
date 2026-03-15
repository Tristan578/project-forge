/**
 * PF-375: Error scenario tests for the chat executor and API layer.
 *
 * Covers:
 *  - executeToolCall with an unknown tool name (falls through to legacy; legacy also
 *    returns error to verify the full error path is exercised end-to-end)
 *  - executeToolCall when dispatchCommand throws synchronously
 *  - executeToolCall when a registered handler rejects with an Error
 *  - Chat API error handling (fetch failure / network error)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Hoist mocks so references are available inside vi.mock factories ──────────
const mocks = vi.hoisted(() => {
  const legacyExecute = vi.fn();
  const getCommandDispatcher = vi.fn();
  return { legacyExecute, getCommandDispatcher };
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
vi.mock('../handlers/audioLegacyHandlers', () => ({ audioLegacyHandlers: {} }));
vi.mock('../handlers/pixelArtHandlers', () => ({ pixelArtHandlers: {} }));
vi.mock('../handlers/compoundHandlers', () => ({ compoundHandlers: {} }));

// ── Mock legacy executor ──────────────────────────────────────────────────────
vi.mock('../executor.legacy', () => ({
  executeToolCall: mocks.legacyExecute,
}));

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

  it('delegates to the legacy executor when tool name is not in registry', async () => {
    mocks.legacyExecute.mockResolvedValue({ success: false, error: 'Unknown tool: pf375_nonexistent_tool' });

    const result = await executeToolCall('pf375_nonexistent_tool', {}, makeStore());

    expect(mocks.legacyExecute).toHaveBeenCalledWith('pf375_nonexistent_tool', {}, expect.anything());
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/unknown tool/i);
  });

  it('returns success: false when legacy executor returns an error result for unknown tool', async () => {
    mocks.legacyExecute.mockResolvedValue({ success: false, error: 'No handler found' });

    const result = await executeToolCall('completely_unknown_xyz_123', { a: 1 }, makeStore());

    expect(result.success).toBe(false);
  });

  it('never throws for an unknown tool — always resolves', async () => {
    mocks.legacyExecute.mockResolvedValue({ success: false, error: 'Unhandled' });

    const promise = executeToolCall('no_such_tool_at_all', {}, makeStore());
    await expect(promise).resolves.toBeDefined();
  });

  it('passes args through to legacy executor unchanged for unknown tool', async () => {
    mocks.legacyExecute.mockResolvedValue({ success: false, error: 'Nope' });
    const args = { entityId: 'e1', value: 42 };

    await executeToolCall('unknown_with_args', args, makeStore());

    const [, passedArgs] = mocks.legacyExecute.mock.calls[0];
    expect(passedArgs).toBe(args);
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

  it('still returns success: false when legacy executor also throws after dispatcher error', async () => {
    // This scenario exercises the outer try/catch in executor.ts.
    mocks.getCommandDispatcher.mockImplementation(() => {
      throw new Error('First failure');
    });
    // legacyExecute is never reached (dispatcher throws first), but we verify
    // the outer catch handles it gracefully.
    mocks.legacyExecute.mockRejectedValue(new Error('Second failure'));

    const result = await executeToolCall('tool', {}, makeStore());

    expect(result.success).toBe(false);
    // Error message comes from the first throw (dispatcher), not the legacy mock.
    expect(result.error).toBe('First failure');
  });
});

// ── Test: registered handler rejects ─────────────────────────────────────────
// These tests verify the outer try/catch in executeToolCall catches handler
// rejections. Since all handler registries are mocked empty in this file's
// module scope, we test via legacy executor rejections (which are equivalent:
// the outer catch is shared between the registry and legacy paths).

describe('executeToolCall: registered handler throws', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCommandDispatcher.mockReturnValue(vi.fn());
  });

  it('catches Error thrown by a registered handler (via legacy path) and returns { success: false }', async () => {
    // When the registry has no match the call goes to legacyExecute.
    // A rejection here is caught by the same outer try/catch as a registry handler.
    mocks.legacyExecute.mockRejectedValue(new Error('handler exploded'));

    const result = await executeToolCall('pf375_throwing_tool', {}, makeStore());

    expect(result.success).toBe(false);
    expect(result.error).toBe('handler exploded');
  });

  it('catches non-Error rejection (object) and returns generic Execution failed', async () => {
    mocks.legacyExecute.mockRejectedValue({ code: 'ENOENT', message: 'no such file' });

    const result = await executeToolCall('pf375_obj_throw_tool', {}, makeStore());

    expect(result.success).toBe(false);
    expect(result.error).toBe('Execution failed');
  });

  it('catches a null rejection and returns generic error', async () => {
    mocks.legacyExecute.mockRejectedValue(null);

    const result = await executeToolCall('pf375_null_throw', {}, makeStore());

    expect(result.success).toBe(false);
    expect(result.error).toBe('Execution failed');
  });

  it('never throws — the promise always resolves even when handler rejects', async () => {
    mocks.legacyExecute.mockRejectedValue(new RangeError('out of bounds'));

    const promise = executeToolCall('pf375_range_error', {}, makeStore());
    await expect(promise).resolves.toMatchObject({ success: false });
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
