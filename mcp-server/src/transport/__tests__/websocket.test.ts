import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocketServer, WebSocket } from 'ws';
import type { AddressInfo } from 'node:net';
import { EditorBridge, NOT_CONNECTED_ERROR } from '../websocket.js';

// A stand-in for the relay: accepts one client and lets the test script what
// it says back. EditorBridge had zero tests before #9293.
async function listen(): Promise<{ port: number; wss: WebSocketServer; last: () => WebSocket | null; close: () => Promise<void> }> {
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  let last: WebSocket | null = null;
  wss.on('connection', (ws) => {
    last = ws;
  });
  await new Promise<void>((resolve) => wss.once('listening', () => resolve()));
  return {
    port: (wss.address() as AddressInfo).port,
    wss,
    last: () => last,
    close: () =>
      new Promise<void>((resolve) => {
        for (const c of wss.clients) c.terminate();
        wss.close(() => resolve());
      }),
  };
}

describe('EditorBridge (#9293)', () => {
  const cleanups: Array<() => Promise<void> | void> = [];
  afterEach(async () => {
    for (const c of cleanups.splice(0)) await c();
    vi.useRealTimers();
  });

  it('rejects executeCommand with the named error while disconnected', async () => {
    const bridge = new EditorBridge('ws://127.0.0.1:1/api/mcp/ws', { maxReconnects: 0 });
    await expect(bridge.executeCommand('spawn_entity', {})).rejects.toThrow(NOT_CONNECTED_ERROR);
  });

  it('resolves a command_result with a matching requestId and ignores a mismatched one', async () => {
    const srv = await listen();
    cleanups.push(() => srv.close());
    const bridge = new EditorBridge(`ws://127.0.0.1:${srv.port}`, { maxReconnects: 0 });
    cleanups.push(() => bridge.disconnect());
    await bridge.connect();

    const sent = new Promise<{ requestId: string; name: string }>((resolve) => {
      srv.last()!.once('message', (raw) => resolve(JSON.parse(raw.toString())));
    });
    const result = bridge.executeCommand('spawn_entity', { kind: 'cube' });
    const frame = await sent;
    expect(frame.name).toBe('spawn_entity');

    srv.last()!.send(JSON.stringify({ type: 'command_result', requestId: 'someone-else', result: 'wrong' }));
    srv.last()!.send(JSON.stringify({ type: 'command_result', requestId: frame.requestId, result: { ok: true } }));
    expect(await result).toEqual({ ok: true });
    expect(bridge.pendingCount()).toBe(0);
  });

  it('rejects with the editor error text when the result carries an error', async () => {
    const srv = await listen();
    cleanups.push(() => srv.close());
    const bridge = new EditorBridge(`ws://127.0.0.1:${srv.port}`, { maxReconnects: 0 });
    cleanups.push(() => bridge.disconnect());
    await bridge.connect();
    const sent = new Promise<{ requestId: string }>((resolve) => {
      srv.last()!.once('message', (raw) => resolve(JSON.parse(raw.toString())));
    });
    const result = bridge.executeCommand('spawn_entity', {});
    const { requestId } = await sent;
    srv.last()!.send(JSON.stringify({ type: 'command_result', requestId, error: 'Unknown tool: spawn_entity' }));
    await expect(result).rejects.toThrow('Unknown tool: spawn_entity');
  });

  it('times out a command that never gets a result, naming the command', async () => {
    const srv = await listen();
    cleanups.push(() => srv.close());
    const bridge = new EditorBridge(`ws://127.0.0.1:${srv.port}`, { maxReconnects: 0, commandTimeoutMs: 30 });
    cleanups.push(() => bridge.disconnect());
    await bridge.connect();
    await expect(bridge.executeCommand('slow_thing', {})).rejects.toThrow("Command 'slow_thing' timed out");
    expect(bridge.pendingCount()).toBe(0);
  });

  it('swallows malformed frames and rejects every pending command when the socket closes', async () => {
    const srv = await listen();
    cleanups.push(() => srv.close());
    const bridge = new EditorBridge(`ws://127.0.0.1:${srv.port}`, { maxReconnects: 0 });
    cleanups.push(() => bridge.disconnect());
    await bridge.connect();
    srv.last()!.send('this is not json');
    const a = bridge.executeCommand('a', {});
    const b = bridge.executeCommand('b', {});
    await new Promise((r) => setTimeout(r, 20));
    expect(bridge.pendingCount()).toBe(2);
    srv.last()!.terminate();
    await expect(a).rejects.toThrow('Editor connection closed');
    await expect(b).rejects.toThrow('Editor connection closed');
    expect(bridge.pendingCount()).toBe(0);
    expect(bridge.isConnected()).toBe(false);
  });

  it('reconnects with backoff a bounded number of times, then stops instead of retrying forever', async () => {
    const bridge = new EditorBridge('ws://127.0.0.1:1/api/mcp/ws', { maxReconnects: 2, reconnectBaseMs: 5, reconnectMaxMs: 10 });
    cleanups.push(() => bridge.disconnect());
    await expect(bridge.connect()).rejects.toThrow();
    // Two scheduled retries, then the bridge declares itself given up.
    await new Promise((r) => setTimeout(r, 200));
    expect(bridge.reconnectAttempts()).toBe(2);
    expect(bridge.gaveUp()).toBe(true);
    expect(bridge.isConnected()).toBe(false);
  });

  it('records editor pushes into the cached scene state', async () => {
    const srv = await listen();
    cleanups.push(() => srv.close());
    const bridge = new EditorBridge(`ws://127.0.0.1:${srv.port}`, { maxReconnects: 0 });
    cleanups.push(() => bridge.disconnect());
    await bridge.connect();
    srv.last()!.send(JSON.stringify({ type: 'scene_graph_update', data: { n: 3 } }));
    srv.last()!.send(JSON.stringify({ type: 'selection_changed', data: [3] }));
    srv.last()!.send(JSON.stringify({ type: 'project_info', data: { name: 'p' } }));
    await new Promise((r) => setTimeout(r, 20));
    expect(bridge.sceneGraph).toEqual({ n: 3 });
    expect(bridge.selection).toEqual([3]);
    expect(bridge.projectInfo).toEqual({ name: 'p' });
  });
});
