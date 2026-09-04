import WebSocket from 'ws';

interface PendingCommand {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export interface EditorBridgeOptions {
  /** Reconnect attempts after a close/failed connect before giving up. Default 10. */
  maxReconnects?: number;
  /** First reconnect delay; doubles each attempt up to reconnectMaxMs. */
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
  /** Per-command timeout. */
  commandTimeoutMs?: number;
  log?: (line: string) => void;
}

export const NOT_CONNECTED_ERROR =
  'Not connected to the MCP relay. Start it with `npm run relay` in mcp-server (MCP_RELAY_TOKEN set), start this server with the same token, and open the editor with ?mcp=<token>.';

/**
 * WebSocket bridge from the MCP server to the loopback relay, and through it
 * to the editor tab that executes commands (#9293; relay protocol in
 * mcp-server/src/relay/server.ts).
 *
 * Reconnects with exponential backoff a BOUNDED number of times, then stops
 * and says so: the previous version retried a URL that never existed every
 * five seconds forever, which is what every stock install did.
 */
export class EditorBridge {
  private ws: WebSocket | null = null;
  private pendingCommands = new Map<string, PendingCommand>();
  private url: string;
  private connected = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private attempts = 0;
  private stopped = false;
  private gaveUpFlag = false;
  private readonly maxReconnects: number;
  private readonly reconnectBaseMs: number;
  private readonly reconnectMaxMs: number;
  private readonly commandTimeoutMs: number;
  private readonly log: (line: string) => void;

  // Latest cached scene state (updated by editor push events)
  public sceneGraph: unknown = null;
  public selection: unknown = null;
  public projectInfo: unknown = null;

  constructor(url: string, options: EditorBridgeOptions = {}) {
    this.url = url;
    this.maxReconnects = options.maxReconnects ?? 10;
    this.reconnectBaseMs = options.reconnectBaseMs ?? 1000;
    this.reconnectMaxMs = options.reconnectMaxMs ?? 30000;
    this.commandTimeoutMs = options.commandTimeoutMs ?? 30000;
    this.log = options.log ?? (() => {});
  }

  async connect(): Promise<void> {
    this.stopped = false;
    return new Promise((resolve, reject) => {
      try {
        const ws = new WebSocket(this.url);
        this.ws = ws;
        let settled = false;

        ws.on('open', () => {
          this.connected = true;
          this.attempts = 0;
          this.gaveUpFlag = false;
          settled = true;
          resolve();
        });

        ws.on('message', (data) => {
          try {
            const msg = JSON.parse(data.toString());
            this.handleMessage(msg);
          } catch {
            // Ignore malformed messages
          }
        });

        ws.on('close', (code, reason) => {
          this.connected = false;
          if (!settled) {
            settled = true;
            const detail = reason.length > 0 ? `: ${reason.toString()}` : '';
            reject(new Error(`MCP relay connection closed before opening (${code})${detail}`));
          }
          for (const [id, pending] of this.pendingCommands) {
            clearTimeout(pending.timeout);
            pending.reject(new Error('Editor connection closed'));
            this.pendingCommands.delete(id);
          }
          this.scheduleReconnect();
        });

        ws.on('error', (err) => {
          if (!settled) {
            settled = true;
            reject(err);
          }
          // 'close' follows and schedules the reconnect.
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    if (this.attempts >= this.maxReconnects) {
      if (!this.gaveUpFlag) {
        this.gaveUpFlag = true;
        this.log(`gave up reconnecting to ${this.url} after ${this.attempts} attempt(s); restart once the relay is up`);
      }
      return;
    }
    const delay = Math.min(this.reconnectBaseMs * 2 ** this.attempts, this.reconnectMaxMs);
    this.attempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch(() => {});
    }, delay);
  }

  disconnect(): void {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  /** Reconnects attempted since the last successful open. */
  reconnectAttempts(): number {
    return this.attempts;
  }

  /** True once the reconnect budget is spent; only a fresh connect() clears it. */
  gaveUp(): boolean {
    return this.gaveUpFlag;
  }

  pendingCount(): number {
    return this.pendingCommands.size;
  }

  /**
   * Execute a command on the editor via the relay.
   * Returns a promise that resolves with the command result.
   */
  async executeCommand(name: string, payload: Record<string, unknown>): Promise<unknown> {
    if (!this.connected || !this.ws) {
      throw new Error(NOT_CONNECTED_ERROR);
    }

    const requestId = crypto.randomUUID();
    const timeoutMs = this.commandTimeoutMs;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingCommands.delete(requestId);
        reject(new Error(`Command '${name}' timed out after ${timeoutMs / 1000}s`));
      }, timeoutMs);

      this.pendingCommands.set(requestId, { resolve, reject, timeout });

      this.ws!.send(
        JSON.stringify({
          type: 'command',
          requestId,
          name,
          payload,
        })
      );
    });
  }

  private handleMessage(msg: { type: string; requestId?: string; result?: unknown; error?: string; [key: string]: unknown }) {
    switch (msg.type) {
      case 'command_result': {
        const pending = this.pendingCommands.get(msg.requestId!);
        if (pending) {
          clearTimeout(pending.timeout);
          this.pendingCommands.delete(msg.requestId!);
          if (msg.error) {
            pending.reject(new Error(msg.error));
          } else {
            pending.resolve(msg.result);
          }
        }
        break;
      }

      // Editor pushes state updates
      case 'scene_graph_update':
        this.sceneGraph = msg.data;
        break;
      case 'selection_changed':
        this.selection = msg.data;
        break;
      case 'project_info':
        this.projectInfo = msg.data;
        break;
    }
  }
}
