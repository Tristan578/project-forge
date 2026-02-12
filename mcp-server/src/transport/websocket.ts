import WebSocket from 'ws';

interface PendingCommand {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

/**
 * WebSocket bridge to the running Project Forge editor.
 * Sends commands and receives responses/scene state.
 */
export class EditorBridge {
  private ws: WebSocket | null = null;
  private pendingCommands = new Map<string, PendingCommand>();
  private url: string;
  private connected = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  // Latest cached scene state (updated by editor push events)
  public sceneGraph: unknown = null;
  public selection: unknown = null;
  public projectInfo: unknown = null;

  constructor(url: string) {
    this.url = url;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url);

        this.ws.on('open', () => {
          this.connected = true;
          resolve();
        });

        this.ws.on('message', (data) => {
          try {
            const msg = JSON.parse(data.toString());
            this.handleMessage(msg);
          } catch {
            // Ignore malformed messages
          }
        });

        this.ws.on('close', () => {
          this.connected = false;
          // Reject all pending commands
          for (const [id, pending] of this.pendingCommands) {
            clearTimeout(pending.timeout);
            pending.reject(new Error('Editor connection closed'));
            this.pendingCommands.delete(id);
          }
          // Auto-reconnect after 5s
          this.reconnectTimer = setTimeout(() => {
            this.connect().catch(() => {});
          }, 5000);
        });

        this.ws.on('error', (err) => {
          if (!this.connected) {
            reject(err);
          }
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
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

  /**
   * Execute a command on the editor engine via the WebSocket bridge.
   * Returns a promise that resolves with the command result.
   */
  async executeCommand(name: string, payload: Record<string, unknown>): Promise<unknown> {
    if (!this.connected || !this.ws) {
      throw new Error(
        'Not connected to the editor. Make sure the Project Forge editor is running.'
      );
    }

    const requestId = crypto.randomUUID();
    const TIMEOUT_MS = 30000;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingCommands.delete(requestId);
        reject(new Error(`Command '${name}' timed out after ${TIMEOUT_MS / 1000}s`));
      }, TIMEOUT_MS);

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
