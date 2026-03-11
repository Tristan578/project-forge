// MainThreadChannel — main-thread side of the typed MessagePort channel.
// Creates a MessageChannel, transfers one port to the worker, and manages
// request/response correlation, timeouts, and backpressure.

import {
  createChannelMessage,
  isChannelMessage,
  type ChannelOptions,
  type CommandPayload,
  type EventPayload,
  type CallbackPayload,
  type ErrorPayload,
  type ResultPayload,
  type BackpressurePayload,
} from './channelProtocol';

// ─── Internal types ────────────────────────────────────────────────────────────

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

// ─── Defaults ──────────────────────────────────────────────────────────────────

const DEFAULT_MAX_QUEUE_SIZE = 1000;
const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_ENABLE_BACKPRESSURE = true;

// ─── MainThreadChannel ────────────────────────────────────────────────────────

/**
 * Main-thread half of a typed MessagePort channel.
 *
 * Usage:
 *   const channel = new MainThreadChannel(worker);
 *   const result = await channel.sendCommand('spawn_entity', { type: 'Cube' });
 */
export class MainThreadChannel {
  private readonly port: MessagePort;
  private readonly pendingRequests = new Map<string, PendingRequest>();
  private readonly callbackHandlers = new Map<string, Set<(data: unknown) => void>>();
  private readonly options: Required<ChannelOptions>;

  /** Number of in-flight command requests awaiting a response. */
  private pendingCount = 0;
  private destroyed = false;

  constructor(worker: Worker, options: ChannelOptions = {}) {
    this.options = {
      maxQueueSize: options.maxQueueSize ?? DEFAULT_MAX_QUEUE_SIZE,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      enableBackpressure: options.enableBackpressure ?? DEFAULT_ENABLE_BACKPRESSURE,
    };

    // Create a dedicated MessageChannel for this script channel.
    const { port1, port2 } = new MessageChannel();
    this.port = port1;
    this.port.onmessage = this.handleMessage.bind(this);

    // Transfer port2 to the worker so it can call initialize(port).
    worker.postMessage({ type: 'channel_port_init' }, [port2]);
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /**
   * Send a command to the worker and await its result.
   * Rejects after `timeoutMs` if no response is received.
   */
  sendCommand<T = unknown>(command: string, args: unknown): Promise<T> {
    if (this.destroyed) {
      return Promise.reject(new Error('MainThreadChannel has been destroyed'));
    }

    if (this.options.enableBackpressure && this.pendingCount >= this.options.maxQueueSize) {
      // Signal backpressure to the worker and reject immediately.
      const bpMsg = createChannelMessage<BackpressurePayload>('backpressure', {
        pendingCount: this.pendingCount,
      });
      this.port.postMessage(bpMsg);
      return Promise.reject(
        new Error(`Channel backpressure: ${this.pendingCount} pending requests exceeds limit ${this.options.maxQueueSize}`),
      );
    }

    return new Promise<T>((resolve, reject) => {
      const msg = createChannelMessage<CommandPayload>('command', { command, args });

      const timer = setTimeout(() => {
        this.pendingRequests.delete(msg.id);
        this.pendingCount = Math.max(0, this.pendingCount - 1);
        reject(new Error(`Command "${command}" timed out after ${this.options.timeoutMs}ms (id: ${msg.id})`));
      }, this.options.timeoutMs);

      this.pendingRequests.set(msg.id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      });

      this.pendingCount++;
      try {
        this.port.postMessage(msg);
      } catch (err) {
        clearTimeout(timer);
        this.pendingRequests.delete(msg.id);
        this.pendingCount = Math.max(0, this.pendingCount - 1);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  /**
   * Send an engine event to the worker (fire-and-forget).
   */
  sendEvent(eventType: string, data: unknown): void {
    if (this.destroyed) return;
    const msg = createChannelMessage<EventPayload>('event', { eventType, data });
    this.port.postMessage(msg);
  }

  /**
   * Register a callback handler for a given callback type.
   * Returns an unsubscribe function.
   */
  onCallback(type: string, handler: (data: unknown) => void): () => void {
    if (!this.callbackHandlers.has(type)) {
      this.callbackHandlers.set(type, new Set());
    }
    this.callbackHandlers.get(type)!.add(handler);

    return () => {
      const handlers = this.callbackHandlers.get(type);
      if (!handlers) {
        return;
      }
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.callbackHandlers.delete(type);
      }
    };
  }

  /**
   * Send a ping and await the pong. Returns round-trip latency in milliseconds.
   */
  ping(): Promise<number> {
    if (this.destroyed) {
      return Promise.reject(new Error('MainThreadChannel has been destroyed'));
    }

    return new Promise<number>((resolve, reject) => {
      const msg = createChannelMessage<Record<string, never>>('ping', {});
      const sent = Date.now();

      const timer = setTimeout(() => {
        this.pendingRequests.delete(msg.id);
        reject(new Error(`Ping timed out after ${this.options.timeoutMs}ms`));
      }, this.options.timeoutMs);

      // Re-use pendingRequests map: when pong arrives with matching id, resolve with latency.
      this.pendingRequests.set(msg.id, {
        resolve: (_v: unknown) => resolve(Date.now() - sent),
        reject,
        timer,
      });

      try {
        this.port.postMessage(msg);
      } catch (err) {
        clearTimeout(timer);
        this.pendingRequests.delete(msg.id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  /**
   * Destroy this channel. All pending requests are rejected and the port is closed.
   */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;

    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error(`Channel destroyed (pending request: ${id})`));
    }
    this.pendingRequests.clear();
    this.callbackHandlers.clear();
    this.port.close();
    this.pendingCount = 0;
  }

  // ─── Private ─────────────────────────────────────────────────────────────────

  private handleMessage(event: MessageEvent): void {
    const msg = event.data;
    if (!isChannelMessage(msg)) return;

    switch (msg.type) {
      case 'result': {
        const payload = msg.payload as ResultPayload;
        const pending = this.pendingRequests.get(payload.requestId);
        if (pending) {
          clearTimeout(pending.timer);
          this.pendingRequests.delete(payload.requestId);
          this.pendingCount = Math.max(0, this.pendingCount - 1);
          pending.resolve(payload.result);
        }
        break;
      }
      case 'pong': {
        // Pong carries the original ping id in message id field.
        const pending = this.pendingRequests.get(msg.id);
        if (pending) {
          clearTimeout(pending.timer);
          this.pendingRequests.delete(msg.id);
          pending.resolve(undefined);
        }
        break;
      }
      case 'callback': {
        const payload = msg.payload as CallbackPayload;
        const handlers = this.callbackHandlers.get(payload.type);
        if (handlers) {
          for (const handler of handlers) {
            handler(payload.data);
          }
        }
        break;
      }
      case 'error': {
        const payload = msg.payload as ErrorPayload;
        if (payload.requestId) {
          const pending = this.pendingRequests.get(payload.requestId);
          if (pending) {
            clearTimeout(pending.timer);
            this.pendingRequests.delete(payload.requestId);
            this.pendingCount = Math.max(0, this.pendingCount - 1);
            pending.reject(new Error(payload.message));
          } else {
            // Received an error for a request that is no longer pending.
            console.error(
              '[MainThreadChannel] Received worker error for unknown requestId',
              payload.requestId,
              '-',
              payload.message,
            );
          }
        } else {
          // Uncorrelated worker error (no requestId) — surface it so it is observable.
          console.error(
            '[MainThreadChannel] Uncorrelated worker error:',
            payload.message,
          );
        }
        break;
      }
      // 'command', 'event', 'ping', 'backpressure' are not expected from worker -> main
      default:
        break;
    }
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Convenience factory — creates a MainThreadChannel for a worker.
 */
export function createScriptChannel(
  worker: Worker,
  options?: ChannelOptions,
): MainThreadChannel {
  return new MainThreadChannel(worker, options);
}
