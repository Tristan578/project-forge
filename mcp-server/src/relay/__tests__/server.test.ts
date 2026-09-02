import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { startRelay, MissingRelayTokenError, NO_EDITOR_ERROR, type RunningRelay } from '../server.js';
import { EditorBridge } from '../../transport/websocket.js';

const TOKEN = 'relay-test-token';

function open(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

function closedWith(url: string): Promise<number> {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    ws.once('close', (code) => resolve(code));
    ws.once('error', () => {});
  });
}

function nextMessage(ws: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    ws.once('message', (raw) => resolve(JSON.parse(raw.toString()) as Record<string, unknown>));
  });
}

describe('MCP loopback relay (#9293)', () => {
  let relay: RunningRelay | null = null;
  const sockets: WebSocket[] = [];
  const url = (role: string, token = TOKEN) => `ws://127.0.0.1:${relay!.port}/api/mcp/ws?role=${role}&token=${token}`;
  const attach = async (role: string, token = TOKEN) => {
    const ws = await open(url(role, token));
    sockets.push(ws);
    return ws;
  };

  afterEach(async () => {
    for (const ws of sockets.splice(0)) ws.terminate();
    await relay?.close();
    relay = null;
  });

  it('refuses to start without a token', async () => {
    await expect(startRelay({ port: 0, token: '' })).rejects.toBeInstanceOf(MissingRelayTokenError);
  });

  it('refuses a wrong token (4401) and an unknown role (4400)', async () => {
    relay = await startRelay({ port: 0, token: TOKEN });
    expect(await closedWith(url('agent', 'nope'))).toBe(4401);
    expect(await closedWith(url('spectator'))).toBe(4400);
  });

  it('answers an agent command at once when no editor is attached, instead of letting it time out', async () => {
    relay = await startRelay({ port: 0, token: TOKEN });
    const agent = await attach('agent');
    const reply = nextMessage(agent);
    agent.send(JSON.stringify({ type: 'command', requestId: 'r1', name: 'spawn_entity', payload: {} }));
    const msg = await reply;
    expect(msg).toMatchObject({ type: 'command_result', requestId: 'r1', error: NO_EDITOR_ERROR });
    expect(relay.state().pending).toBe(0);
  });

  it('round-trips a command and its result between an agent and the editor, and broadcasts editor pushes', async () => {
    relay = await startRelay({ port: 0, token: TOKEN });
    const editor = await attach('editor');
    const agent = await attach('agent');
    expect(relay.state()).toEqual({ editorAttached: true, agents: 1, pending: 0 });

    const seenByEditor = nextMessage(editor);
    agent.send(JSON.stringify({ type: 'command', requestId: 'r2', name: 'spawn_entity', payload: { kind: 'cube' } }));
    expect(await seenByEditor).toEqual({ type: 'command', requestId: 'r2', name: 'spawn_entity', payload: { kind: 'cube' } });
    expect(relay.state().pending).toBe(1);

    const seenByAgent = nextMessage(agent);
    editor.send(JSON.stringify({ type: 'command_result', requestId: 'r2', result: { entityId: 7 } }));
    expect(await seenByAgent).toEqual({ type: 'command_result', requestId: 'r2', result: { entityId: 7 } });
    expect(relay.state().pending).toBe(0);

    const push = nextMessage(agent);
    editor.send(JSON.stringify({ type: 'selection_changed', data: [7] }));
    expect(await push).toEqual({ type: 'selection_changed', data: [7] });
  });

  it('refuses a second editor (4409) while one is attached', async () => {
    relay = await startRelay({ port: 0, token: TOKEN });
    await attach('editor');
    expect(await closedWith(url('editor'))).toBe(4409);
  });

  it('rejects the in-flight commands of an editor that disconnects', async () => {
    relay = await startRelay({ port: 0, token: TOKEN });
    const editor = await attach('editor');
    const agent = await attach('agent');
    agent.send(JSON.stringify({ type: 'command', requestId: 'r3', name: 'spawn_entity', payload: {} }));
    await nextMessage(editor);
    const reply = nextMessage(agent);
    editor.terminate();
    const msg = await reply;
    expect(msg).toMatchObject({ type: 'command_result', requestId: 'r3' });
    expect(String(msg.error)).toContain('Editor disconnected');
    expect(relay.state().pending).toBe(0);
  });

  it('ignores malformed frames and unknown result ids without leaking pending entries', async () => {
    relay = await startRelay({ port: 0, token: TOKEN });
    const editor = await attach('editor');
    const agent = await attach('agent');
    editor.send('not json');
    editor.send(JSON.stringify({ type: 'command_result', requestId: 'never-sent', result: 1 }));
    agent.send('{"type":"command"}'); // no requestId
    await new Promise((r) => setTimeout(r, 50));
    expect(relay.state().pending).toBe(0);
    expect(relay.state().editorAttached).toBe(true);
  });

  // The assertion that would have caught the original defect: the REAL
  // EditorBridge, dialling the relay, executes a command against an editor.
  it('integration: a real EditorBridge executes spawn_entity through the relay and receives editor pushes', async () => {
    relay = await startRelay({ port: 0, token: TOKEN });
    const editor = await attach('editor');
    editor.on('message', (raw) => {
      const frame = JSON.parse(raw.toString()) as { type: string; requestId: string; name: string; payload: unknown };
      if (frame.type === 'command') {
        editor.send(JSON.stringify({ type: 'command_result', requestId: frame.requestId, result: { ok: true, name: frame.name, payload: frame.payload } }));
      }
    });
    const bridge = new EditorBridge(url('agent'), { maxReconnects: 0 });
    try {
      await bridge.connect();
      const result = await bridge.executeCommand('spawn_entity', { kind: 'cube' });
      expect(result).toEqual({ ok: true, name: 'spawn_entity', payload: { kind: 'cube' } });

      editor.send(JSON.stringify({ type: 'project_info', data: { name: 'demo' } }));
      editor.send(JSON.stringify({ type: 'scene_graph_update', data: { entities: 1 } }));
      editor.send(JSON.stringify({ type: 'selection_changed', data: [1] }));
      await new Promise((r) => setTimeout(r, 50));
      expect(bridge.projectInfo).toEqual({ name: 'demo' });
      expect(bridge.sceneGraph).toEqual({ entities: 1 });
      expect(bridge.selection).toEqual([1]);
    } finally {
      bridge.disconnect();
    }
  });
});
