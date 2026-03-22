/**
 * Unified SSE streaming helper for AI generation endpoints.
 *
 * Standardises the Server-Sent Events envelope used by all AI feature modules
 * that call /api/chat. Instead of duplicating the SSE reader logic across
 * tutorialGenerator, worldBuilder, behaviorTree, etc., every module imports
 * the helpers here.
 *
 * Supports two stream formats:
 *
 * Legacy format (current):
 *   data    — incremental text chunk        { type: 'text_delta', text: string }
 *   progress — percentage 0–100             { type: 'progress', percent: number }
 *   error   — fatal error, abort streaming  { type: 'error', message: string }
 *   done    — stream finished               { type: 'done' } or data: [DONE]
 *
 * AI SDK UI message stream format (Phase 2+ migration):
 *   Identified by `x-vercel-ai-ui-message-stream: v1` response header.
 *   Uses { type: 'text-delta', delta: string } for text chunks (hyphen, 'delta' field).
 *   Error events: { type: 'error', errorText: string }
 *   Finish events: { type: 'finish', ... } (treated as done)
 */

// ---------------------------------------------------------------------------
// Envelope event types
// ---------------------------------------------------------------------------

export interface SSETextDelta {
  type: 'text_delta';
  text: string;
}

export interface SSEProgress {
  type: 'progress';
  percent: number;
}

export interface SSEError {
  type: 'error';
  message: string;
}

export interface SSEDone {
  type: 'done';
}

export type SSEEnvelopeEvent = SSETextDelta | SSEProgress | SSEError | SSEDone;

// ---------------------------------------------------------------------------
// Streaming options & callbacks
// ---------------------------------------------------------------------------

export interface StreamCallbacks {
  /** Called for each incremental text chunk. */
  onText?: (chunk: string) => void;
  /** Called when a progress event arrives (0–100). */
  onProgress?: (percent: number) => void;
  /** Called when an error event arrives. Streaming stops after this. */
  onError?: (message: string) => void;
}

// ---------------------------------------------------------------------------
// Parse a single SSE "data:" line into an envelope event
// ---------------------------------------------------------------------------

/**
 * Parse one `data: <payload>` line from an SSE stream.
 * Returns null for lines that should be skipped (e.g. heartbeats, [DONE]).
 */
export function parseSSELine(line: string): SSEEnvelopeEvent | null {
  if (!line.startsWith('data: ')) return null;

  const payload = line.slice(6).trim();
  if (payload === '[DONE]') return { type: 'done' };
  if (payload === '') return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('type' in parsed) ||
    typeof (parsed as Record<string, unknown>).type !== 'string'
  ) {
    return null;
  }

  const evt = parsed as Record<string, unknown>;

  switch (evt.type) {
    case 'text_delta':
      return typeof evt.text === 'string' ? { type: 'text_delta', text: evt.text } : null;
    case 'progress':
      return typeof evt.percent === 'number'
        ? { type: 'progress', percent: Math.min(100, Math.max(0, evt.percent)) }
        : null;
    case 'error':
      return typeof evt.message === 'string' ? { type: 'error', message: evt.message } : null;
    case 'done':
      return { type: 'done' };
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// AI SDK UI message stream format support
// ---------------------------------------------------------------------------

/**
 * Parse one `data: <payload>` line from an AI SDK UI message stream.
 *
 * The AI SDK stream protocol uses hyphenated event types and a `delta` field
 * for text content, as opposed to the legacy `text_delta` + `text` format.
 *
 * Relevant event types:
 *   { type: 'text-delta', id: string, delta: string }   — incremental text
 *   { type: 'error', errorText: string }                 — fatal error
 *   { type: 'finish', ... }                              — stream complete
 *
 * All other event types (tool-input-start, reasoning-*, etc.) are silently
 * skipped — generation modules only care about accumulated text output.
 */
export function parseAiSdkSSELine(line: string): SSEEnvelopeEvent | null {
  if (!line.startsWith('data: ')) return null;

  const payload = line.slice(6).trim();
  if (payload === '[DONE]') return { type: 'done' };
  if (payload === '') return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('type' in parsed) ||
    typeof (parsed as Record<string, unknown>).type !== 'string'
  ) {
    return null;
  }

  const evt = parsed as Record<string, unknown>;

  switch (evt.type) {
    case 'text-delta':
      // AI SDK uses `delta` field (not `text`)
      return typeof evt.delta === 'string' ? { type: 'text_delta', text: evt.delta } : null;
    case 'error': {
      // AI SDK error events use `errorText` field
      const msg =
        typeof evt.errorText === 'string'
          ? evt.errorText
          : typeof evt.message === 'string'
            ? evt.message
            : 'AI stream error';
      return { type: 'error', message: msg };
    }
    case 'finish':
    case 'finish-step':
      return { type: 'done' };
    default:
      // text-start, text-end, tool-input-*, reasoning-*, source-*, start, start-step, abort
      // are all silently skipped — generation modules only need accumulated text
      return null;
  }
}

/**
 * Returns true if the response was produced by the AI SDK's
 * `toUIMessageStreamResponse()` helper.
 *
 * The AI SDK sets the `x-vercel-ai-ui-message-stream: v1` header on all
 * responses created by that helper.  Detection via header is preferred over
 * content sniffing because both formats use `data:` lines.
 */
export function isAiSdkStream(response: Response): boolean {
  return response.headers.get('x-vercel-ai-ui-message-stream') === 'v1';
}

// ---------------------------------------------------------------------------
// Low-level: read all chunks from a ReadableStream and return accumulated text
// ---------------------------------------------------------------------------

/**
 * Consume an SSE `ReadableStreamDefaultReader` to completion and return the
 * accumulated text content.  Fires optional callbacks for each event type.
 *
 * Throws if an `error` event is received from the stream.
 */
export async function readSSEStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  callbacks?: StreamCallbacks,
): Promise<string> {
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // Process only complete (newline-terminated) lines; carry the remainder.
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const event = parseSSELine(line);
      if (event === null) continue;

      switch (event.type) {
        case 'text_delta':
          content += event.text;
          callbacks?.onText?.(event.text);
          break;
        case 'progress':
          callbacks?.onProgress?.(event.percent);
          break;
        case 'error':
          callbacks?.onError?.(event.message);
          throw new Error(event.message);
        case 'done':
          break;
      }
    }
  }

  // Flush any remaining bytes from the decoder (multi-byte UTF-8 split across final chunks)
  buffer += decoder.decode();

  // Process any remaining buffered line (stream may not end with newline)
  if (buffer.trim()) {
    const event = parseSSELine(buffer);
    if (event !== null && event.type === 'text_delta') {
      content += event.text;
      callbacks?.onText?.(event.text);
    }
  }

  return content;
}

/**
 * Consume an AI SDK UI message stream `ReadableStreamDefaultReader` to
 * completion and return the accumulated text content.
 *
 * Handles the AI SDK's `text-delta` event format (hyphenated type, `delta`
 * field) while re-using the same `StreamCallbacks` interface as `readSSEStream`.
 *
 * Throws if an `error` event is received from the stream.
 */
export async function readAiSdkStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  callbacks?: StreamCallbacks,
): Promise<string> {
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const event = parseAiSdkSSELine(line);
      if (event === null) continue;

      switch (event.type) {
        case 'text_delta':
          content += event.text;
          callbacks?.onText?.(event.text);
          break;
        case 'progress':
          callbacks?.onProgress?.(event.percent);
          break;
        case 'error':
          callbacks?.onError?.(event.message);
          throw new Error(event.message);
        case 'done':
          break;
      }
    }
  }

  // Flush decoder and process any trailing buffered line
  buffer += decoder.decode();
  if (buffer.trim()) {
    const event = parseAiSdkSSELine(buffer);
    if (event !== null && event.type === 'text_delta') {
      content += event.text;
      callbacks?.onText?.(event.text);
    }
  }

  return content;
}

// ---------------------------------------------------------------------------
// High-level: POST to /api/chat and stream the response
// ---------------------------------------------------------------------------

export interface ChatStreamOptions {
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  model: string;
  sceneContext?: string;
  thinking?: boolean;
  systemOverride?: string;
  callbacks?: StreamCallbacks;
}

/**
 * POST a request to /api/chat, verify the response, then stream SSE events
 * back to the caller and return the accumulated text content.
 *
 * Automatically detects whether the server returned the AI SDK UI message
 * stream format (`x-vercel-ai-ui-message-stream: v1` header) and delegates
 * to the appropriate reader.  This allows a gradual server-side migration
 * (Phase 2) without requiring simultaneous client changes.
 *
 * This is the single canonical way to call the chat API from AI feature
 * modules.  Centralising it ensures consistent error handling and streaming
 * behaviour across all modules.
 */
export async function streamChat(options: ChatStreamOptions): Promise<string> {
  const { messages, model, sceneContext = '', thinking = false, systemOverride, callbacks } = options;

  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, model, sceneContext, thinking, systemOverride }),
  });

  if (!response.ok) {
    let errorMsg = `Chat request failed: ${response.status}`;
    try {
      const errorData = (await response.json()) as Record<string, unknown>;
      if (typeof errorData.error === 'string') {
        errorMsg = errorData.error;
      }
    } catch {
      /* response body may not be JSON */
    }
    throw new Error(errorMsg);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body from /api/chat');

  // Route to the appropriate stream reader based on server response format.
  // Phase 2 migration: when the server adopts toUIMessageStreamResponse(),
  // it sets x-vercel-ai-ui-message-stream: v1. The legacy path continues
  // to work until Phase 3 removes the old server-side code path entirely.
  if (isAiSdkStream(response)) {
    return readAiSdkStream(reader, callbacks);
  }

  return readSSEStream(reader, callbacks);
}
