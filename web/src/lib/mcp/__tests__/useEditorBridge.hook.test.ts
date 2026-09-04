// @vitest-environment jsdom
/**
 * The hook's own contract (#9293): consent before any socket, a bounded
 * reconnect, and no retry on a close code a retry cannot fix.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

import {
  useEditorBridge,
  MCP_BRIDGE_MAX_RECONNECTS,
  MCP_BRIDGE_FATAL_CLOSE_CODES,
} from '../useEditorBridge';

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static readonly OPEN = 1;
  readonly OPEN = 1;
  readyState = 0;
  sent: string[] = [];
  closedWith: { code?: number; reason?: string } | null = null;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((e: { code: number; reason: string }) => void) | null = null;

  constructor(public readonly url: string) {
    FakeWebSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close(code?: number, reason?: string) {
    this.closedWith = { code, reason };
    this.readyState = 3;
  }
  /** Drive the socket the way a relay would. */
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  serverClose(code: number, reason = '') {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }
}

/**
 * Run every timer the hook may have scheduled to completion. Used to prove a
 * NEGATIVE — that no reconnect was queued — where a real-time sleep would only
 * ever prove "not yet".
 */
async function drainTimers() {
  vi.useFakeTimers();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(10_000);
  });
  vi.useRealTimers();
}

describe('useEditorBridge', () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
    vi.stubEnv('NODE_ENV', 'development');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    window.history.replaceState({}, '', '/editor?mcp=abc123');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('stays off, and opens no socket, without ?mcp=<token>', async () => {
    window.history.replaceState({}, '', '/editor');
    const { result } = renderHook(() => useEditorBridge());
    await waitFor(() => expect(result.current.status).toBe('off'));
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  // The token arrives in a URL, and a URL can be sent to someone. Opening the
  // socket on sight would make a link enough to hand a remote process the
  // editor's controls.
  it('opens no socket until the attach is approved', async () => {
    const { result } = renderHook(() => useEditorBridge());
    await waitFor(() => expect(result.current.status).toBe('awaiting-consent'));
    expect(FakeWebSocket.instances).toHaveLength(0);

    act(() => result.current.approve());
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    expect(FakeWebSocket.instances[0].url).toContain('role=editor');
    expect(FakeWebSocket.instances[0].url).toContain('token=abc123');

    act(() => FakeWebSocket.instances[0].open());
    await waitFor(() => expect(result.current.status).toBe('attached'));
    expect(JSON.parse(FakeWebSocket.instances[0].sent[0])).toEqual({
      type: 'project_info',
      data: { attached: true },
    });
  });

  it('detaches on request and does not reconnect', async () => {
    const { result } = renderHook(() => useEditorBridge());
    await waitFor(() => expect(result.current.status).toBe('awaiting-consent'));
    act(() => result.current.approve());
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    act(() => FakeWebSocket.instances[0].open());
    await waitFor(() => expect(result.current.status).toBe('attached'));

    act(() => result.current.detach());
    await waitFor(() => expect(result.current.status).toBe('detached'));
    expect(FakeWebSocket.instances[0].closedWith?.code).toBe(1000);
    // Drain every timer the hook could have scheduled: a retry would surface
    // as a second socket. Fake timers make that exhaustive rather than a race.
    await drainTimers();
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('does not let a stale approve callback reconnect after detach', async () => {
    const { result } = renderHook(() => useEditorBridge());
    await waitFor(() => expect(result.current.status).toBe('awaiting-consent'));
    const staleApprove = result.current.approve;

    act(() => result.current.detach());
    await waitFor(() => expect(result.current.status).toBe('detached'));
    act(() => staleApprove());
    await drainTimers();

    expect(result.current.status).toBe('detached');
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  // React StrictMode mounts the editor twice; the second mount races the
  // first's teardown and the relay answers 4409. Without a retry the tab
  // stayed silently unattached for the rest of its life.
  it('reconnects after 4409 (an editor is already attached)', async () => {
    const { result } = renderHook(() => useEditorBridge());
    await waitFor(() => expect(result.current.status).toBe('awaiting-consent'));
    act(() => result.current.approve());
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));

    act(() => FakeWebSocket.instances[0].serverClose(4409, 'an editor is already attached'));
    await waitFor(() => expect(result.current.status).toBe('reconnecting'));
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(2), { timeout: 2000 });

    act(() => FakeWebSocket.instances[1].open());
    await waitFor(() => expect(result.current.status).toBe('attached'));
  });

  it('gives up after a bounded number of attempts instead of retrying forever', async () => {
    const { result } = renderHook(() => useEditorBridge());
    await waitFor(() => expect(result.current.status).toBe('awaiting-consent'));
    act(() => result.current.approve());

    for (let i = 0; i <= MCP_BRIDGE_MAX_RECONNECTS; i++) {
      await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(i + 1), { timeout: 5000 });
      act(() => FakeWebSocket.instances[i].serverClose(1006, ''));
    }
    await waitFor(() => expect(result.current.status).toBe('detached'));
    expect(FakeWebSocket.instances).toHaveLength(MCP_BRIDGE_MAX_RECONNECTS + 1);
    expect(result.current.detail).toContain('Gave up');
    expect(console.error).toHaveBeenCalled();
  });

  it.each([...MCP_BRIDGE_FATAL_CLOSE_CODES])('does not retry close code %i, and says why', async (code) => {
    const { result } = renderHook(() => useEditorBridge());
    await waitFor(() => expect(result.current.status).toBe('awaiting-consent'));
    act(() => result.current.approve());
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));

    act(() => FakeWebSocket.instances[0].serverClose(code, 'bad token'));
    await waitFor(() => expect(result.current.status).toBe('refused'));
    expect(result.current.detail).toBeTruthy();
    expect(console.error).toHaveBeenCalled();
    // A retry could only ever be refused again.
    await drainTimers();
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  // Both of these live in the window between an inbound frame arriving and the
  // hook finishing with it. Neither is reachable through the module-scope
  // import of the hook, so each mounts its own copy against a mocked
  // `bridgeFrame`.
  describe('inbound frames the happy path does not cover', () => {
    afterEach(() => {
      vi.doUnmock('../bridgeFrame');
      vi.resetModules();
    });

    async function mountWith(factory: () => { handleBridgeFrame: typeof import('../bridgeFrame').handleBridgeFrame }) {
      vi.resetModules();
      vi.doMock('../bridgeFrame', factory);
      const { useEditorBridge: hook } = await import('../useEditorBridge');
      const { result } = renderHook(() => hook());
      await waitFor(() => expect(result.current.status).toBe('awaiting-consent'));
      act(() => result.current.approve());
      await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
      act(() => FakeWebSocket.instances[0].open());
      await waitFor(() => expect(result.current.status).toBe('attached'));
      return result;
    }

    // The relay answers every `command` with exactly one `command_result`. A
    // chunk that fails to load must not be the one path that answers none: the
    // agent would wait out its own timeout with nothing said anywhere, and the
    // relay would hold the `pending` entry until a socket closed.
    it('answers the frame when the handler chunk fails to load', async () => {
      await mountWith((): never => {
        throw new Error('chunk load failed');
      });
      const socket = FakeWebSocket.instances[0];
      act(() => {
        socket.onmessage?.({
          data: JSON.stringify({ type: 'command', requestId: 'req-1', name: 'spawn_entity' }),
        });
      });
      await waitFor(() => expect(socket.sent).toHaveLength(2));
      expect(JSON.parse(socket.sent[1])).toEqual({
        type: 'command_result',
        requestId: 'req-1',
        error: 'The editor could not load its bridge handler',
      });
      expect(console.error).toHaveBeenCalled();
    });

    // `detached` is state, so the cleanup that closes the socket does not run
    // until React commits. A frame delivered in that window used to reach the
    // executor and mutate the scene after the user had detached.
    it('runs no command that arrives between detach() and the socket closing', async () => {
      const handleBridgeFrame = vi.fn(async () => {});
      const result = await mountWith(() => ({ handleBridgeFrame }));
      const socket = FakeWebSocket.instances[0];

      // Deliberately un-acted: act() would flush the cleanup and close the
      // window this test exists to cover.
      result.current.detach();
      socket.onmessage?.({
        data: JSON.stringify({ type: 'command', requestId: 'req-2', name: 'spawn_entity' }),
      });

      await act(async () => {
        await Promise.resolve();
      });
      expect(handleBridgeFrame).not.toHaveBeenCalled();
    });
  });

  it('reports a socket error rather than failing silently', async () => {
    const { result } = renderHook(() => useEditorBridge());
    await waitFor(() => expect(result.current.status).toBe('awaiting-consent'));
    act(() => result.current.approve());
    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));

    act(() => FakeWebSocket.instances[0].onerror?.());
    await waitFor(() => expect(result.current.detail).toContain('MCP relay'));
    expect(console.error).toHaveBeenCalled();
  });
});
