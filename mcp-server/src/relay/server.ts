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
 * THREAT MODEL. "Loopback" is not a boundary on its own: a WebSocket handshake
 * is exempt from the same-origin policy, and any web page the user visits runs
 * on the user's machine and is therefore a loopback peer. So the handshake is
 * gated on the ORIGIN header, which a browser always sends and cannot forge:
 *   - `role=agent` must arrive with NO `Origin` at all. The Node `ws` client
 *     sends none; a browser cannot suppress it. This is what keeps a hostile
 *     page from driving the editor, and it holds even if the token leaks.
 *   - `role=editor` must arrive with an `Origin` this machine serves the
 *     editor from (see `isEditorOrigin`), extensible via `editorOrigins`.
 *   - the `Host` header must name a loopback address, which closes DNS
 *     rebinding (a name that resolves to 127.0.0.1 carries its own Host).
 * A rejected handshake never becomes a WebSocket: it is answered with HTTP 403
 * from `verifyClient`, before any frame can be sent.
 *
 * Rules, each pinned by relay/__tests__/server.test.ts:
 *   - loopback only: `startRelay` refuses a non-loopback `host`, the listener
 *     binds 127.0.0.1, and a non-loopback peer is refused at the handshake;
 *   - cross-origin refusal: the Origin/Host rules above;
 *   - a shared token of at least MIN_RELAY_TOKEN_LENGTH characters is REQUIRED
 *     on both roles (`?token=`), compared in constant time; a mismatch is 4401
 *     and repeated mismatches lock the relay out for AUTH_LOCKOUT_MS;
 *   - exactly one editor: a second editor is refused with 4409;
 *   - an agent command with no editor attached is answered at once with an
 *     error frame, never left to hit EditorBridge's 30 s timeout;
 *   - an editor disconnect rejects every in-flight command — and ONLY when the
 *     socket that closed is still the attached editor.
 */
import { WebSocketServer, WebSocket } from 'ws';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface RelayOptions {
  /** Port to listen on; 0 picks an ephemeral port (tests). */
  port: number;
  /** Shared secret both roles must present as `?token=`. Required. */
  token: string;
  /** Host to bind; defaults to 127.0.0.1 and MUST be loopback. */
  host?: string;
  path?: string;
  /** Extra exact origins accepted for `role=editor`, beyond the local defaults. */
  editorOrigins?: string[];
  log?: (line: string) => void;
}

export interface RunningRelay {
  port: number;
  /** The address actually bound, so the loopback rule is observable. */
  host: string;
  close: () => Promise<void>;
  /** Snapshot for tests and the CLI banner. */
  state: () => { editorAttached: boolean; agents: number; pending: number; authFailures: number };
}

export const RELAY_DEFAULT_PORT = 3001;
export const RELAY_DEFAULT_PATH = '/api/mcp/ws';
/** `openssl rand -hex 32` is 64 chars; this is the floor, not the recommendation. */
export const MIN_RELAY_TOKEN_LENGTH = 32;
/** Consecutive bad tokens before the relay stops answering for a while. */
export const MAX_TOKEN_FAILURES = 5;
export const AUTH_LOCKOUT_MS = 60_000;
export const NO_EDITOR_ERROR =
  'No editor is attached to the MCP relay. Open the SpawnForge editor with ?mcp=<token> in the URL (the token the relay was started with).';

export class MissingRelayTokenError extends Error {
  constructor() {
    super('MCP_RELAY_TOKEN is required: the relay refuses to start without a shared secret');
    this.name = 'MissingRelayTokenError';
  }
}

export class WeakRelayTokenError extends Error {
  constructor(length: number) {
    super(
      `MCP_RELAY_TOKEN is ${length} characters; at least ${MIN_RELAY_TOKEN_LENGTH} are required. Generate one with: openssl rand -hex 32`,
    );
    this.name = 'WeakRelayTokenError';
  }
}

export class NonLoopbackHostError extends Error {
  constructor(host: string) {
    super(`the MCP relay refuses to bind ${host}: it is loopback-only (127.0.0.1 or ::1)`);
    this.name = 'NonLoopbackHostError';
  }
}

const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const PUSH_TYPES = new Set(['scene_graph_update', 'selection_changed', 'project_info']);

/** Bind addresses the relay will accept. `localhost` is excluded on purpose: it can resolve off-loopback. */
export function isLoopbackBindHost(host: string): boolean {
  return LOOPBACK_ADDRESSES.has(host);
}

/** True when the connecting peer's socket address is on this machine. */
export function isLoopbackPeer(remoteAddress: string | undefined): boolean {
  return remoteAddress !== undefined && LOOPBACK_ADDRESSES.has(remoteAddress);
}

/** True when the `Host` header names a loopback address (anti DNS-rebinding). */
export function isLoopbackHostHeader(hostHeader: string | undefined): boolean {
  if (!hostHeader) return false;
  // Strip the port without tripping over IPv6 brackets.
  const hostname = hostHeader.startsWith('[')
    ? hostHeader.slice(0, hostHeader.indexOf(']') + 1)
    : hostHeader.split(':')[0];
  return LOOPBACK_HOSTNAMES.has(hostname.toLowerCase());
}

/**
 * Origins this machine serves the SpawnForge editor from: portless
 * (`*.spawnforge.localhost`, worktrees get a subdomain) and the raw dev server
 * on localhost/127.0.0.1. Anything else must be named explicitly in `extra`.
 */
export function isEditorOrigin(origin: string | undefined, extra: readonly string[] = []): boolean {
  if (!origin) return false;
  if (extra.includes(origin)) return true;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  const hostname = url.hostname.toLowerCase();
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    hostname === '::1' ||
    hostname === 'spawnforge.localhost' ||
    hostname.endsWith('.spawnforge.localhost')
  );
}

/**
 * Why this handshake must be refused, or null to let it through. Pure so the
 * suite can drive every branch — including the non-loopback peer, which no
 * loopback-bound listener can otherwise produce.
 */
export function handshakeRejection(
  req: Pick<IncomingMessage, 'url' | 'headers'> & { socket: { remoteAddress?: string } },
  extraEditorOrigins: readonly string[] = [],
): string | null {
  if (!isLoopbackPeer(req.socket.remoteAddress)) {
    return `non-loopback peer ${req.socket.remoteAddress ?? '(unknown)'}`;
  }
  if (!isLoopbackHostHeader(req.headers.host)) {
    return `Host header '${req.headers.host ?? '(none)'}' is not loopback`;
  }
  const role = new URL(req.url ?? '/', 'http://relay.local').searchParams.get('role');
  const origin = req.headers.origin;
  // An unknown role is answered with close code 4400 after the handshake, so
  // it carries no Origin rule of its own.
  if (role === 'agent' && origin !== undefined) {
    return `an agent must not send an Origin (got '${origin}'): a browser page cannot hold this role`;
  }
  if (role === 'editor' && !isEditorOrigin(origin, extraEditorOrigins)) {
    return `Origin '${origin ?? '(none)'}' is not an editor origin`;
  }
  return null;
}

/** Constant-time token comparison; hashing first makes the lengths equal. */
export function tokensMatch(presented: string | null, expected: string): boolean {
  const a = createHash('sha256').update(presented ?? '').digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

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
  if (options.token.length < MIN_RELAY_TOKEN_LENGTH) throw new WeakRelayTokenError(options.token.length);
  const host = options.host ?? '127.0.0.1';
  if (!isLoopbackBindHost(host)) throw new NonLoopbackHostError(host);
  const path = options.path ?? RELAY_DEFAULT_PATH;
  const editorOrigins = options.editorOrigins ?? [];
  const log = options.log ?? (() => {});

  let editor: WebSocket | null = null;
  const agents = new Set<WebSocket>();
  /** requestId -> the agent waiting for it. */
  const pending = new Map<string, WebSocket>();
  let authFailures = 0;
  let lockedUntil = 0;

  const wss = new WebSocketServer({
    host,
    port: options.port,
    path,
    verifyClient: (
      info: { req: IncomingMessage },
      cb: (ok: boolean, code?: number, message?: string) => void,
    ) => {
      if (Date.now() < lockedUntil) {
        log('refused a handshake: locked out after repeated bad tokens');
        cb(false, 429, 'Too Many Requests');
        return;
      }
      const rejection = handshakeRejection(info.req, editorOrigins);
      if (rejection) {
        log(`refused a handshake: ${rejection}`);
        cb(false, 403, 'Forbidden');
        return;
      }
      cb(true);
    },
  });

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const url = new URL(req.url ?? '/', 'http://relay.local');
    if (!tokensMatch(url.searchParams.get('token'), options.token)) {
      authFailures += 1;
      if (authFailures >= MAX_TOKEN_FAILURES) {
        lockedUntil = Date.now() + AUTH_LOCKOUT_MS;
        authFailures = 0;
        log(`locking the relay for ${AUTH_LOCKOUT_MS / 1000}s after ${MAX_TOKEN_FAILURES} bad tokens`);
      }
      log('refused peer with a wrong or missing token');
      ws.close(4401, 'bad token');
      return;
    }
    authFailures = 0;
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
        // A replacement editor may attach while this socket is CLOSING. Only
        // the socket that is still current owns the pending command set, so a
        // stale close must not tear down the live editor's work.
        if (editor !== ws) return;
        editor = null;
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
  const bound = wss.address() as AddressInfo;
  log(`relay listening on ws://${bound.address}:${bound.port}${path}`);

  return {
    port: bound.port,
    host: bound.address,
    state: () => ({
      editorAttached: editor !== null && editor.readyState === WebSocket.OPEN,
      agents: agents.size,
      pending: pending.size,
      authFailures,
    }),
    close: () =>
      new Promise<void>((resolve) => {
        for (const client of wss.clients) client.terminate();
        wss.close(() => resolve());
      }),
  };
}
