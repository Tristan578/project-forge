// WorkerChannel — worker-side half of the typed MessagePort channel.
// Receives a MessagePort from the main thread via postMessage and exposes
// a typed API for command dispatch, result sending, and callbacks.

import {
  createChannelMessage,
  isChannelMessage,
  type ChannelMessage,
  type CommandPayload,
  type EventPayload,
  type ResultPayload,
  type CallbackPayload,
  type ErrorPayload,
  type BackpressurePayload,
} from './channelProtocol';

// ─── Handler types ─────────────────────────────────────────────────────────────

export type CommandHandler = (
  command: string,
  args: unknown,
  requestId: string,
) => void;

export type EventHandler = (eventType: string, data: unknown) => void;

export type BackpressureHandler = (queueSize: number) => void;

// ─── WorkerChannel ────────────────────────────────────────────────────────────

/**
 * Worker-side half of a typed MessagePort channel.
 *
 * Call `initialize(port)` once the port is received from the main thread.
 *
 * Example worker setup:
 *   const channel = new WorkerChannel();
 *   self.onmessage = (e) => {
 *     if (e.data?.type === 'channel_port_init') channel.initialize(e.ports[0]);
 *   };
 *   channel.onCommand((cmd, args, requestId) => { ... });
 */
export class WorkerChannel {
  private port: MessagePort | null = null;
  private commandHandler: CommandHandler | null = null;
  private eventHandler: EventHandler | null = null;
  private backpressureHandler: BackpressureHandler | null = null;

  // ─── Initialisation ──────────────────────────────────────────────────────────

  /**
   * Bind the channel to the given MessagePort received from the main thread.
   * Must be called exactly once before sending or receiving.
   */
  initialize(port: MessagePort): void {
    if (this.port !== null) {
      throw new Error('WorkerChannel already initialised');
    }
    this.port = port;
    this.port.onmessage = this.handleMessage.bind(this);
  }

  // ─── Sending ─────────────────────────────────────────────────────────────────

  /**
   * Resolve a pending command by sending its result back to the main thread.
   */
  sendResult(requestId: string, result: unknown): void {
    this.assertInitialized();
    const msg = createChannelMessage<ResultPayload>('result', { requestId, result });
    this.port!.postMessage(msg);
  }

  /**
   * Send a script callback (e.g., collision event) to the main thread.
   */
  sendCallback(type: string, data: unknown): void {
    this.assertInitialized();
    const msg = createChannelMessage<CallbackPayload>('callback', { type, data });
    this.port!.postMessage(msg);
  }

  /**
   * Report an error to the main thread, optionally correlating to a request.
   */
  sendError(requestId: string | undefined, error: Error): void {
    this.assertInitialized();
    const msg = createChannelMessage<ErrorPayload>('error', {
      requestId,
      message: error.message,
    });
    this.port!.postMessage(msg);
  }

  // ─── Receiving ───────────────────────────────────────────────────────────────

  /**
   * Register the handler invoked for every 'command' message received.
   * Replaces any previously registered handler.
   */
  onCommand(handler: CommandHandler): void {
    this.commandHandler = handler;
  }

  /**
   * Register the handler invoked for every 'event' message received.
   * Replaces any previously registered handler.
   */
  onEvent(handler: EventHandler): void {
    this.eventHandler = handler;
  }

  /**
   * Register a handler invoked when the main thread signals backpressure.
   * The worker should throttle or pause sending until pressure eases.
   */
  onBackpressure(handler: BackpressureHandler): void {
    this.backpressureHandler = handler;
  }

  // ─── Private ─────────────────────────────────────────────────────────────────

  private handleMessage(event: MessageEvent): void {
    const msg: unknown = event.data;
    if (!isChannelMessage(msg)) return;

    switch ((msg as ChannelMessage).type) {
      case 'command': {
        if (this.commandHandler) {
          const payload = (msg as ChannelMessage<CommandPayload>).payload;
          this.commandHandler(payload.command, payload.args, (msg as ChannelMessage).id);
        }
        break;
      }
      case 'event': {
        if (this.eventHandler) {
          const payload = (msg as ChannelMessage<EventPayload>).payload;
          this.eventHandler(payload.eventType, payload.data);
        }
        break;
      }
      case 'ping': {
        // Echo back a pong carrying the same id so main thread can correlate.
        if (this.port) {
          const pong = createChannelMessage<Record<string, never>>(
            'pong',
            {},
            (msg as ChannelMessage).id,
          );
          this.port.postMessage(pong);
        }
        break;
      }
      case 'backpressure': {
        if (this.backpressureHandler) {
          const payload = (msg as ChannelMessage<BackpressurePayload>).payload;
          this.backpressureHandler(payload.pendingCount);
        }
        break;
      }
      // 'result', 'callback', 'error', 'pong' not expected from main -> worker
      default:
        break;
    }
  }

  private assertInitialized(): void {
    if (this.port === null) {
      throw new Error('WorkerChannel not yet initialised — call initialize(port) first');
    }
  }
}
