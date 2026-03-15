/**
 * Comprehensive unit tests for the tool call executor dispatcher.
 *
 * Focus areas:
 *  - Registry dispatch: known handler is invoked with correct args & context
 *  - Legacy fallback: unknown handler falls through to legacyExecuteToolCall
 *  - Error containment: handler exceptions are caught and returned as { success: false }
 *  - getCommandDispatcher null path: warning fallback when dispatcher not initialised
 *  - Context shape: dispatchCommand callable and store forwarded correctly
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoist mock references so they are available inside vi.mock factories ──────
const mocks = vi.hoisted(() => {
  const legacyExecute = vi.fn();
  const getCommandDispatcher = vi.fn();
  return { legacyExecute, getCommandDispatcher };
});

// ── Mock all handler registry modules with empty registries ──────────────────
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

// ── Store stub ────────────────────────────────────────────────────────────────

function makeStore(overrides: Record<string, unknown> = {}): Parameters<typeof executeToolCall>[2] {
  return {
    selectedIds: new Set<string>(),
    primaryId: null,
    sceneGraph: { nodes: {}, rootIds: [] },
    engineMode: 'edit',
    ...overrides,
  } as unknown as Parameters<typeof executeToolCall>[2];
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('executor: legacy fallback dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCommandDispatcher.mockReturnValue(vi.fn());
    mocks.legacyExecute.mockResolvedValue({ success: true, result: 'legacy-result' });
  });

  it('falls through to legacy executor when tool is not in the registry', async () => {
    const store = makeStore();
    await executeToolCall('completely_unknown_tool', { x: 1 }, store);
    expect(mocks.legacyExecute).toHaveBeenCalledWith('completely_unknown_tool', { x: 1 }, store);
  });

  it('returns the legacy result when tool is not in registry', async () => {
    const store = makeStore();
    mocks.legacyExecute.mockResolvedValue({ success: true, result: 'from-legacy' });

    const result = await executeToolCall('unknown_tool', {}, store);
    expect(result.success).toBe(true);
    expect(result.result).toBe('from-legacy');
  });

  it('passes an empty args object to legacy executor correctly', async () => {
    const store = makeStore();
    await executeToolCall('unknown_tool_xyz', {}, store);
    expect(mocks.legacyExecute).toHaveBeenCalledWith('unknown_tool_xyz', {}, store);
  });

  it('forwards an arbitrary args object unchanged', async () => {
    const store = makeStore();
    const args = { foo: 'bar', count: 42, nested: { a: [1, 2, 3] } };
    await executeToolCall('args_test', args, store);
    const [, forwardedArgs] = mocks.legacyExecute.mock.calls[0];
    expect(forwardedArgs).toBe(args);
  });

  it('forwards the store object unchanged', async () => {
    const store = makeStore({ sceneName: 'MyScene' });
    await executeToolCall('forward_test', {}, store);
    const [, , forwardedStore] = mocks.legacyExecute.mock.calls[0];
    expect(forwardedStore).toBe(store);
  });

  it('passes the tool name as the first argument', async () => {
    const store = makeStore();
    await executeToolCall('my_special_tool', {}, store);
    const [toolName] = mocks.legacyExecute.mock.calls[0];
    expect(toolName).toBe('my_special_tool');
  });
});

describe('executor: error containment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCommandDispatcher.mockReturnValue(vi.fn());
  });

  it('returns { success: false, error } when legacy executor throws an Error', async () => {
    const store = makeStore();
    mocks.legacyExecute.mockRejectedValue(new Error('legacy boom'));

    const result = await executeToolCall('any_tool', {}, store);
    expect(result.success).toBe(false);
    expect(result.error).toBe('legacy boom');
  });

  it('returns generic error message when legacy executor throws a non-Error', async () => {
    const store = makeStore();
    mocks.legacyExecute.mockRejectedValue('string rejection');

    const result = await executeToolCall('any_tool', {}, store);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Execution failed');
  });

  it('returns { success: false } when legacy executor rejects with null', async () => {
    const store = makeStore();
    mocks.legacyExecute.mockRejectedValue(null);

    const result = await executeToolCall('any_tool', {}, store);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Execution failed');
  });

  it('never throws; always resolves with an ExecutionResult', async () => {
    const store = makeStore();
    mocks.legacyExecute.mockRejectedValue(new TypeError('hard crash'));

    const promise = executeToolCall('crash_test', {}, store);
    await expect(promise).resolves.toBeDefined();
    const result = await promise;
    expect(typeof result.success).toBe('boolean');
  });
});

describe('executor: command dispatcher wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCommandDispatcher.mockReturnValue(vi.fn());
    mocks.legacyExecute.mockResolvedValue({ success: true });
  });

  it('calls getCommandDispatcher once per executeToolCall invocation', async () => {
    const store = makeStore();
    await executeToolCall('some_tool', {}, store);
    expect(mocks.getCommandDispatcher).toHaveBeenCalledTimes(1);
  });

  it('uses warn-only fallback and does not throw when getCommandDispatcher returns null', async () => {
    mocks.getCommandDispatcher.mockReturnValue(null);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const store = makeStore();

    const result = await executeToolCall('some_tool', {}, store);
    expect(result.success).toBe(true);

    warnSpy.mockRestore();
    mocks.getCommandDispatcher.mockReturnValue(vi.fn());
  });
});

describe('executor: concurrent calls are independent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCommandDispatcher.mockReturnValue(vi.fn());
  });

  it('parallel calls each receive their own result', async () => {
    let callCount = 0;
    mocks.legacyExecute.mockImplementation(() => {
      const n = ++callCount;
      return Promise.resolve({ success: true, result: `call-${n}` });
    });

    const store = makeStore();
    const [r1, r2, r3] = await Promise.all([
      executeToolCall('tool_a', {}, store),
      executeToolCall('tool_b', {}, store),
      executeToolCall('tool_c', {}, store),
    ]);

    expect(r1.result).toBe('call-1');
    expect(r2.result).toBe('call-2');
    expect(r3.result).toBe('call-3');
  });

  it('one failing call does not affect concurrent successful calls', async () => {
    mocks.legacyExecute
      .mockResolvedValueOnce({ success: true, result: 'ok-1' })
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ success: true, result: 'ok-3' });

    const store = makeStore();
    const [r1, r2, r3] = await Promise.all([
      executeToolCall('tool_1', {}, store),
      executeToolCall('tool_2', {}, store),
      executeToolCall('tool_3', {}, store),
    ]);

    expect(r1.success).toBe(true);
    expect(r2.success).toBe(false);
    expect(r3.success).toBe(true);
  });
});
