// Channel Protocol — typed bidirectional MessagePort communication between main thread and script worker.
// Uses MessageChannel API for a dedicated port pair with request/response correlation,
// backpressure, and health-check (ping/pong).

// ─── Message types ─────────────────────────────────────────────────────────────

export type ChannelMessageType =
  | 'command'       // Main -> Worker: execute engine command
  | 'result'        // Worker -> Main: command result
  | 'event'         // Main -> Worker: engine event notification
  | 'callback'      // Worker -> Main: script callback (e.g., collision handler)
  | 'error'         // Either direction: error report
  | 'ping'          // Health check (either direction)
  | 'pong'          // Health check response
  | 'backpressure'; // Flow control signal

export interface ChannelMessage<T = unknown> {
  /** Unique message ID for request/response correlation. */
  id: string;
  type: ChannelMessageType;
  payload: T;
  timestamp: number;
}

export interface ChannelOptions {
  /** Maximum number of pending requests before backpressure triggers. Default: 1000. */
  maxQueueSize?: number;
  /** Milliseconds before a pending request is rejected. Default: 5000. */
  timeoutMs?: number;
  /** Whether to emit backpressure signals when queue is full. Default: true. */
  enableBackpressure?: boolean;
}

// ─── Payload shapes ────────────────────────────────────────────────────────────

export interface CommandPayload {
  command: string;
  args: unknown;
}

export interface ResultPayload {
  requestId: string;
  result: unknown;
}

export interface EventPayload {
  eventType: string;
  data: unknown;
}

export interface CallbackPayload {
  type: string;
  data: unknown;
}

export interface ErrorPayload {
  requestId?: string;
  message: string;
}

export interface BackpressurePayload {
  pendingCount: number;
}

// ─── Port initialisation message (sent once from main -> worker) ───────────────

export interface PortInitMessage {
  type: 'channel_port_init';
  // The MessagePort is transferred (not serialised) — listed in the transfer list.
}

// ─── Validation helpers ────────────────────────────────────────────────────────

const VALID_TYPES = new Set<string>([
  'command', 'result', 'event', 'callback', 'error', 'ping', 'pong', 'backpressure',
]);

/**
 * Returns true if the given value is a structurally valid ChannelMessage.
 * Used in tests and defensive receive handlers.
 */
export function isChannelMessage(value: unknown): value is ChannelMessage {
  if (typeof value !== 'object' || value === null) return false;
  const m = value as Record<string, unknown>;
  return (
    typeof m.id === 'string' &&
    typeof m.type === 'string' &&
    VALID_TYPES.has(m.type) &&
    typeof m.timestamp === 'number' &&
    'payload' in m
  );
}

/**
 * Create a ChannelMessage with a generated ID and current timestamp.
 */
export function createChannelMessage<T>(
  type: ChannelMessageType,
  payload: T,
  id?: string,
): ChannelMessage<T> {
  return {
    id: id ?? crypto.randomUUID(),
    type,
    payload,
    timestamp: Date.now(),
  };
}
