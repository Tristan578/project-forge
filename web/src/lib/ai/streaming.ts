/**
 * Unified SSE streaming helper for SpawnForge AI routes.
 *
 * All AI routes that produce server-sent events must use this module to ensure
 * a consistent event envelope format:
 *
 *   { type: 'data',     ... }   — streaming payload chunk
 *   { type: 'progress', ... }   — progress update (e.g. polling status)
 *   { type: 'error',    ... }   — error during generation
 *   { type: 'done',     ... }   — generation complete
 *
 * Usage:
 *   const { send, response } = createSSEResponse();
 *   // Pass `response` to the outer Response immediately.
 *   // Drive the stream from a background task via the returned helpers.
 */

// ---------------------------------------------------------------------------
// Event envelope types
// ---------------------------------------------------------------------------

export interface SSEDataEvent {
  type: 'data';
  [key: string]: unknown;
}

export interface SSEProgressEvent {
  type: 'progress';
  message: string;
  percent?: number;
}

export interface SSEErrorEvent {
  type: 'error';
  message: string;
  code?: string;
}

export interface SSEDoneEvent {
  type: 'done';
  [key: string]: unknown;
}

export type SSEEvent = SSEDataEvent | SSEProgressEvent | SSEErrorEvent | SSEDoneEvent;

// ---------------------------------------------------------------------------
// Stream builder
// ---------------------------------------------------------------------------

export interface SSEStreamHandle {
  /**
   * Enqueue a single typed SSE event to the client.
   * Serialises the event as `data: <json>\n\n`.
   */
  send: (event: SSEEvent) => void;
  /**
   * Close the stream cleanly. Must be called once all events are sent.
   * Calling close() a second time is a no-op.
   */
  close: () => void;
  /**
   * The Response object to return from the route handler.
   * This must be returned *before* any await that could delay headers.
   */
  response: Response;
}

/**
 * Create a streaming `text/event-stream` Response together with a handle that
 * lets the caller push events into it asynchronously.
 *
 * Pattern:
 * ```ts
 * export async function POST(req: NextRequest) {
 *   const { send, close, response } = createSSEResponse();
 *   // Return response immediately so the browser opens the stream.
 *   void runGeneration().then(result => {
 *     send({ type: 'done', ...result });
 *     close();
 *   }).catch(err => {
 *     send({ type: 'error', message: String(err) });
 *     close();
 *   });
 *   return response;
 * }
 * ```
 */
export function createSSEResponse(): SSEStreamHandle {
  const encoder = new TextEncoder();
  let controllerRef: ReadableStreamDefaultController | null = null;
  let closed = false;

  const stream = new ReadableStream({
    start(controller) {
      controllerRef = controller;
    },
  });

  const response = new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });

  function send(event: SSEEvent): void {
    if (closed || !controllerRef) return;
    try {
      controllerRef.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
    } catch {
      // Stream was closed externally — swallow to avoid cascading errors.
    }
  }

  function close(): void {
    if (closed || !controllerRef) return;
    closed = true;
    try {
      controllerRef.close();
    } catch {
      // Already closed.
    }
  }

  return { send, close, response };
}

// ---------------------------------------------------------------------------
// Adapter: ResolveChatStreamEvent → SSEEvent
// ---------------------------------------------------------------------------

/**
 * Map a `ResolveChatStreamEvent` (from resolveChat) to the canonical SSEEvent
 * shape so chat routes can use the same helper.
 */
export function chatEventToSSE(
  event: { type: string; [key: string]: unknown },
): SSEEvent {
  if (event.type === 'error') {
    return {
      type: 'error',
      message: typeof event.message === 'string' ? event.message : 'Unknown error',
    };
  }
  if (event.type === 'turn_complete') {
    return {
      type: 'done',
      stop_reason: event.stop_reason,
    };
  }
  // text_delta, tool_start, usage, thinking_delta etc. are forwarded as data.
  // Spread the event first, then override `type` so the 'data' envelope type wins.
  const { type: _originalType, ...rest } = event;
  return { ...rest, type: 'data' } as SSEDataEvent;
}

// ---------------------------------------------------------------------------
// Legacy adapter: existing chat/route.ts sends raw JSON — this wrapper allows
// gradual migration without breaking the chat panel.
// ---------------------------------------------------------------------------

/**
 * Convert a raw event object to the legacy `data: <json>\n\n` format.
 * Existing consumers (ChatPanel) still parse the underlying event type from
 * the payload, so we preserve that shape under `data`.
 */
export function encodeRawSSE(event: unknown): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
}

// ---------------------------------------------------------------------------
// Parse helpers (client-side)
// ---------------------------------------------------------------------------

/**
 * Parse a raw SSE `data:` line into an SSEEvent.
 * Returns null when the line should be skipped (empty, `[DONE]`, etc.).
 */
export function parseSSELine(line: string): SSEEvent | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed === 'data: [DONE]') return null;
  if (!trimmed.startsWith('data: ')) return null;
  try {
    const parsed = JSON.parse(trimmed.slice('data: '.length)) as unknown;
    if (typeof parsed === 'object' && parsed !== null && 'type' in parsed) {
      return parsed as SSEEvent;
    }
    return null;
  } catch {
    return null;
  }
}
