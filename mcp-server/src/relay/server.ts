/**
 * Loopback relay between the MCP server (`role=agent`) and a live editor tab
 * (`role=editor`) — the missing other end of `EditorBridge` (#9293; ADR
 * docs/decisions/2026-09-02-mcp-editor-bridge-relay.md).
 *
 * Wire protocol (JSON text frames, one object per frame):
 *   agent  -> relay  { type: 'command', requestId, name, payload }
 *   relay  -> editor   (forwarded verbatim)
 *   editor -> relay  { type: 'command_result', requestId, result?, error? }
 *   relay  -> agent    (forwarded to the agent that sent the requestId)
 *   editor -> relay  { type: 'scene_graph_update' | 'selection_changed' | 'project_info', data }
 *   relay  -> agents   (broadcast)
 *
 * Rules, each pinned by relay/__tests__/server.test.ts:
 *   - loopback only: the listener binds 127.0.0.1 and a non-loopback peer is
 *     closed with 4403 even if it somehow reaches the socket;
 *   - a shared token is REQUIRED on both roles (`?token=`); a mismatch is 4401;
 *   - exactly one editor: a second editor is refused with 4409;
 *   - an agent command with no editor attached is answered at once with an
 *     error frame, never left to hit EditorBridge's 30 s timeout;
 *   - an editor disconnect rejects every in-flight command.
 */
import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface RelayOptions {
  /** Port to listen on; 0 picks an ephemeral port (tests). */
  port: number;
  /** Shared secret both roles must present as `?token=`. Required. */
  token: string;
  /** Host to bind; defaults to 127.0.0.1 and must stay loopback. */
  host?: string;
  path?: string;
  log?: (line: string) => void;
}

export interface RunningRelay {
  port: number;
  close: () => Promise<void>;
  /** Snapshot for tests and the CLI banner. */
  state: () => { editorAttached: boolean; agents: number; pending: number };
}

export const RELAY_DEFAULT_PORT = 3001;
export const RELAY_DEFAULT_PATH = '/api/mcp/ws';
export const NO_EDITOR_ERROR =
  'No editor is attached to the MCP relay. Open the SpawnForge editor with ?mcp=<token> in the URL (the token the relay was started with).';

export class MissingRelayTokenError extends Error {
  constructor() {
    super('MCP_RELAY_TOKEN is required: the relay refuses to start without a shared secret');
    this.name = 'MissingRelayTokenError';
  }
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const PUSH_TYPES = new Set(['scene_graph_update', 'selection_changed', 'project_info']);

interface Frame {
  type?: unknown;
  requestId?: unknown;
  name?: unknown;
  payload?: unknown;
  result?: unknown;
  error?: unknown;
  data?: unknown;
}

function parseFrame(raw: unknown): Frame | null {
  try {
    const obj = JSON.parse(String(raw)) as unknown;
    return obj && typeof obj === 'object' ? (obj as Frame) : null;
  } catch {
    return null;
  }
}

function send(ws: WebSocket, frame: Record<string, unknown>): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(frame));
}

export async function startRelay(options: RelayOptions): Promise<RunningRelay> {
  if (!options.token) throw new MissingRelayTokenError();
  const host = options.host ?? '127.0.0.1';
  const path = options.path ?? RELAY_DEFAULT_PATH;
  const log = options.log ?? (() => {});

  let editor: WebSocket | null = null;
  const agents = new Set<WebSocket>();
  /** requestId -> the agent waiting for it. */
  const pending = new Map<string, WebSocket>();

  const wss = new WebSocketServer({ host, port: options.port, path });

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const remote = req.socket.remoteAddress ?? '';
    if (!LOOPBACK.has(remote)) {
      log(`refused non-loopback peer ${remote}`);
      ws.close(4403, 'loopback only');
      return;
    }
    const url = new URL(req.url ?? '/', 'http://relay.local');
    if (url.searchParams.get('token') !== options.token) {
      log('refused peer with a wrong or missing token');
      ws.close(4401, 'bad token');
      return;
    }
    const role = url.searchParams.get('role');

    if (role === 'editor') {
      if (editor && editor.readyState === WebSocket.OPEN) {
        log('refused a second editor');
        ws.close(4409, 'an editor is already attached');
        return;
      }
      editor = ws;
      log('editor attached');
      ws.on('message', (raw) => {
        const frame = parseFrame(raw);
        if (!frame) return;
        if (frame.type === 'command_result' && typeof frame.requestId === 'string') {
          const agent = pending.get(frame.requestId);
          pending.delete(frame.requestId);
          if (agent) send(agent, frame as Record<string, unknown>);
          return;
        }
        if (typeof frame.type === 'string' && PUSH_TYPES.has(frame.type)) {
          for (const agent of agents) send(agent, frame as Record<string, unknown>);
        }
      });
      ws.on('close', () => {
        if (editor === ws) editor = null;
        log('editor detached');
        // Every in-flight command belongs to a tab that is gone.
        for (const [requestId, agent] of pending) {
          send(agent, { type: 'command_result', requestId, error: 'Editor disconnected before answering' });
        }
        pending.clear();
      });
      return;
    }

    if (role === 'agent') {
      agents.add(ws);
      log('agent attached');
      ws.on('message', (raw) => {
        const frame = parseFrame(raw);
        if (!frame || frame.type !== 'command' || typeof frame.requestId !== 'string') return;
        if (!editor || editor.readyState !== WebSocket.OPEN) {
          send(ws, { type: 'command_result', requestId: frame.requestId, error: NO_EDITOR_ERROR });
          return;
        }
        pending.set(frame.requestId, ws);
        send(editor, frame as Record<string, unknown>);
      });
      ws.on('close', () => {
        agents.delete(ws);
        for (const [requestId, agent] of pending) {
          if (agent === ws) pending.delete(requestId);
        }
        log('agent detached');
      });
      return;
    }

    ws.close(4400, 'role must be editor or agent');
  });

  await new Promise<void>((resolve, reject) => {
    wss.once('listening', () => resolve());
    wss.once('error', reject);
  });
  const port = (wss.address() as AddressInfo).port;
  log(`relay listening on ws://${host}:${port}${path}`);

  return {
    port,
    state: () => ({
      editorAttached: editor !== null && editor.readyState === WebSocket.OPEN,
      agents: agents.size,
      pending: pending.size,
    }),
    close: () =>
      new Promise<void>((resolve) => {
        for (const client of wss.clients) client.terminate();
        wss.close(() => resolve());
      }),
  };
}
