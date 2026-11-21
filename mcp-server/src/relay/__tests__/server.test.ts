import { afterEach, describe, expect, it } from 'vitest';
import type { Socket } from 'node:net';
import WebSocket from 'ws';
import {
  startRelay,
  MissingRelayTokenError,
  WeakRelayTokenError,
  NonLoopbackHostError,
  NO_EDITOR_ERROR,
  MAX_TOKEN_FAILURES,
  handshakeRejection,
  isEditorOrigin,
  isLoopbackBindHost,
  isLoopbackHostHeader,
  isLoopbackPeer,
  tokensMatch,
  type RunningRelay,
} from '../server.js';
import { EditorBridge } from '../../transport/websocket.js';

// >= MIN_RELAY_TOKEN_LENGTH: startRelay refuses anything shorter.
const TOKEN = 'relay-test-token-0123456789abcdef';
const EDITOR_ORIGIN = 'http://spawnforge.localhost:1355';

function open(url: string, options?: WebSocket.ClientOptions): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, options);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

function closedWith(url: string, options?: WebSocket.ClientOptions): Promise<number> {
  return new Promise((resolve) => {
    const ws = new WebSocket(url, options);
    ws.once('close', (code) => resolve(code));
    ws.once('error', () => {});
  });
}

function handshakeError(url: string, options?: WebSocket.ClientOptions): Promise<string> {
  return new Promise((resolve) => {
    const ws = new WebSocket(url, options);
    ws.once('error', (err) => resolve(err.message));
    ws.once('open', () => resolve('unexpectedly opened'));
  });
}

function nextMessage(ws: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    ws.once('message', (raw) => resolve(JSON.parse(raw.toString()) as Record<string, unknown>));
  });
}

async function until(predicate: () => boolean, label: string, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe('MCP loopback relay (#9293)', () => {
  let relay: RunningRelay | null = null;
  const sockets: WebSocket[] = [];
  const url = (role: string, token = TOKEN) => `ws://127.0.0.1:${relay!.port}/api/mcp/ws?role=${role}&token=${token}`;
  /** An editor is a browser tab, so it always carries an Origin; an agent never does. */
  const asEditor: WebSocket.ClientOptions = { origin: EDITOR_ORIGIN };
  const attach = async (role: string, token = TOKEN) => {
    const ws = await open(url(role, token), role === 'editor' ? asEditor : undefined);
    sockets.push(ws);
    return ws;
  };

  afterEach(async () => {
    for (const ws of sockets.splice(0)) ws.terminate();
    await relay?.close();
    relay = null;
  });

  it('refuses to start without a token, with a weak token, or off loopback', async () => {
    await expect(startRelay({ port: 0, token: '' })).rejects.toBeInstanceOf(MissingRelayTokenError);
    await expect(startRelay({ port: 0, token: 'x' })).rejects.toBeInstanceOf(WeakRelayTokenError);
    await expect(startRelay({ port: 0, token: TOKEN, host: '0.0.0.0' })).rejects.toBeInstanceOf(NonLoopbackHostError);
  });

  it('binds loopback, and says so', async () => {
    relay = await startRelay({ port: 0, token: TOKEN });
    expect(relay.host).toBe('127.0.0.1');
  });

  it('refuses a wrong token (4401) and an unknown role (4400)', async () => {
    relay = await startRelay({ port: 0, token: TOKEN });
    expect(await closedWith(url('agent', 'nope'))).toBe(4401);
    expect(await closedWith(url('spectator'))).toBe(4400);
  });

  it('locks out after repeated bad tokens instead of allowing unlimited guesses', async () => {
    relay = await startRelay({ port: 0, token: TOKEN });
    for (let i = 0; i < MAX_TOKEN_FAILURES; i++) {
      expect(await closedWith(url('agent', `guess-${i}`))).toBe(4401);
    }
    // Locked: the handshake itself is refused now, so even the RIGHT token
    // cannot get in — a 403/429 handshake error, not a 4401 close.
    expect(await handshakeError(url('agent'))).toContain('429');
  });

  it('refuses a browser page posing as an agent (Origin present) and a foreign editor origin', async () => {
    relay = await startRelay({ port: 0, token: TOKEN });
    // Cross-site WebSocket hijacking: a page on any site is a loopback peer.
    expect(await handshakeError(url('agent'), { origin: 'https://evil.example' })).toContain('403');
    expect(await handshakeError(url('editor'), { origin: 'https://evil.example' })).toContain('403');
    // ...and an editor with no Origin at all is not a browser tab.
    expect(await handshakeError(url('editor'))).toContain('403');
  });

  it('refuses a rebound Host header', async () => {
    relay = await startRelay({ port: 0, token: TOKEN });
    const rebound = { headers: { host: `attacker.example:${relay.port}` } };
    expect(await handshakeError(url('agent'), rebound)).toContain('403');
  });

  it('accepts an extra editor origin only when it was configured', async () => {
    relay = await startRelay({ port: 0, token: TOKEN, editorOrigins: ['http://editor.test'] });
    const ws = await open(url('editor'), { origin: 'http://editor.test' });
    sockets.push(ws);
    expect(relay.state().editorAttached).toBe(true);
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
    expect(relay.state()).toMatchObject({ editorAttached: true, agents: 1, pending: 0 });

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
    expect(await closedWith(url('editor'), asEditor)).toBe(4409);
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

  // The departing editor is NOT the attached one: its close must not answer
  // the agent on behalf of the editor that replaced it.
  it('a stale editor closing leaves the replacing editor in-flight commands alone', async () => {
    relay = await startRelay({ port: 0, token: TOKEN });
    const stale = await attach('editor');
    // Send the close frame but never read the reply, so the relay's copy of
    // this socket sits in CLOSING while the next editor attaches.
    (stale as unknown as { _socket: Socket })._socket.pause();
    stale.close();
    await until(() => relay!.state().editorAttached === false, 'the stale editor to leave OPEN');

    const live = await attach('editor');
    const agent = await attach('agent');
    const seenByLive = nextMessage(live);
    agent.send(JSON.stringify({ type: 'command', requestId: 'r4', name: 'spawn_entity', payload: {} }));
    await seenByLive;
    expect(relay.state().pending).toBe(1);

    let answeredEarly: Record<string, unknown> | null = null;
    agent.once('message', (raw) => {
      answeredEarly = JSON.parse(raw.toString()) as Record<string, unknown>;
    });
    stale.terminate();
    await new Promise((r) => setTimeout(r, 100));
    expect(answeredEarly).toBeNull();
    expect(relay.state().pending).toBe(1);
    expect(relay.state().editorAttached).toBe(true);

    const seenByAgent = nextMessage(agent);
    live.send(JSON.stringify({ type: 'command_result', requestId: 'r4', result: { entityId: 9 } }));
    expect(await seenByAgent).toEqual({ type: 'command_result', requestId: 'r4', result: { entityId: 9 } });
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

// The listener is pinned to loopback, so a non-loopback PEER cannot be produced
// against a running relay. These drive the decision directly instead of
// asserting an adjacent property.
describe('handshake gate (pure)', () => {
  const req = (over: {
    remoteAddress?: string;
    host?: string;
    origin?: string;
    role?: string;
  }) => ({
    url: `/api/mcp/ws?role=${over.role ?? 'agent'}&token=t`,
    headers: {
      host: 'host' in over ? over.host : '127.0.0.1:3001',
      ...(over.origin ? { origin: over.origin } : {}),
    },
    socket: { remoteAddress: 'remoteAddress' in over ? over.remoteAddress : '127.0.0.1' },
  });

  it('refuses a non-loopback peer', () => {
    expect(handshakeRejection(req({ remoteAddress: '192.168.1.20' }))).toContain('non-loopback peer');
    expect(handshakeRejection(req({ remoteAddress: undefined }))).toContain('non-loopback peer');
    expect(handshakeRejection(req({ remoteAddress: '::ffff:127.0.0.1' }))).toBeNull();
  });

  it('refuses a non-loopback Host header (DNS rebinding)', () => {
    expect(handshakeRejection(req({ host: 'attacker.example:3001' }))).toContain('not loopback');
    expect(handshakeRejection(req({ host: undefined }))).toContain('not loopback');
    expect(handshakeRejection(req({ host: '[::1]:3001' }))).toBeNull();
  });

  it('refuses an agent that carries an Origin, and an editor that does not', () => {
    expect(handshakeRejection(req({ role: 'agent', origin: 'https://evil.example' }))).toContain('must not send an Origin');
    expect(handshakeRejection(req({ role: 'agent' }))).toBeNull();
    expect(handshakeRejection(req({ role: 'editor' }))).toContain('not an editor origin');
    expect(handshakeRejection(req({ role: 'editor', origin: 'https://evil.example' }))).toContain('not an editor origin');
    expect(handshakeRejection(req({ role: 'editor', origin: 'http://spawnforge.localhost:1355' }))).toBeNull();
  });

  it('leaves an unknown role to the 4400 close path rather than the Origin rule', () => {
    expect(handshakeRejection(req({ role: 'spectator', origin: 'https://evil.example' }))).toBeNull();
  });

  it('knows which origins serve the editor on this machine', () => {
    for (const ok of [
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'http://spawnforge.localhost:1355',
      'https://spawnforge.localhost',
      'http://t9293.spawnforge.localhost:1355',
    ]) {
      expect(isEditorOrigin(ok), ok).toBe(true);
    }
    for (const no of [
      'https://evil.example',
      'http://spawnforge.localhost.evil.example',
      'file://',
      'null',
      '',
      undefined,
    ]) {
      expect(isEditorOrigin(no), String(no)).toBe(false);
    }
    // Only because it was configured — not by default.
    expect(isEditorOrigin('http://editor.test')).toBe(false);
    expect(isEditorOrigin('http://editor.test', ['http://editor.test'])).toBe(true);
  });

  it('pins the loopback predicates the bind and Host rules rest on', () => {
    expect(isLoopbackBindHost('127.0.0.1')).toBe(true);
    expect(isLoopbackBindHost('::1')).toBe(true);
    expect(isLoopbackBindHost('0.0.0.0')).toBe(false);
    // `localhost` is a NAME: it can be pointed anywhere, so it is not a bind address.
    expect(isLoopbackBindHost('localhost')).toBe(false);
    expect(isLoopbackPeer('127.0.0.1')).toBe(true);
    expect(isLoopbackPeer('10.0.0.5')).toBe(false);
    expect(isLoopbackHostHeader('localhost:1355')).toBe(true);
    expect(isLoopbackHostHeader('127.0.0.1')).toBe(true);
    expect(isLoopbackHostHeader('example.com:3001')).toBe(false);
  });

  it('compares tokens without leaking their length or prefix', () => {
    expect(tokensMatch('abc', 'abc')).toBe(true);
    expect(tokensMatch('abc', 'abd')).toBe(false);
    // A byte-wise === would throw or shortcut on a length mismatch; hashing first must not.
    expect(tokensMatch('a', 'a-much-longer-token')).toBe(false);
    expect(tokensMatch(null, '')).toBe(true);
    expect(tokensMatch(null, 'x')).toBe(false);
  });
});
