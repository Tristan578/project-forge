/**
 * Utilities for testing SSE/streaming responses (chat API, etc.)
 */

/**
 * Creates a ReadableStream from an array of SSE event objects.
 * Each event is encoded as `data: JSON\n\n`, with a single `data: [DONE]\n\n` sentinel at the end.
 */
export function createSSEStream(events: unknown[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const lines = events.map((e) => `data: ${JSON.stringify(e)}\n\n`);
  lines.push('data: [DONE]\n\n');
  const encoded = encoder.encode(lines.join(''));

  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoded);
      controller.close();
    },
  });
}

/**
 * Creates a mock fetch Response with an SSE body stream.
 * Use with vi.mocked(fetch).mockResolvedValue(mockSSEResponse([...])).
 */
export function mockSSEResponse(events: unknown[], status = 200): Response {
  return new Response(createSSEStream(events), {
    status,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

/**
 * Creates a standard sequence of SSE events simulating one chat turn, encoded in
 * the **AI SDK v7 `UIMessageChunk` protocol** (wire shape unchanged from v6)
 * that `/api/chat` actually emits via `result.toUIMessageStreamResponse(...)`.
 * Chunk types are HYPHENATED and carry the SDK's field names (`text-delta` →
 * `delta`, `reasoning-delta` → `delta`,
 * `tool-input-available` → full parsed `input`). Usage rides on the `finish`
 * chunk's `messageMetadata`, mirroring the route's `messageMetadata` callback.
 *
 * This fixture is the source of truth for the wire shape — the client parser in
 * `chatStore.streamOneTurn` is tested against exactly these bytes, so a future
 * protocol drift between route and client fails a test instead of silently
 * blanking every reply (the #8746 regression).
 *
 * @param text - The assistant text content for this turn
 * @param toolCalls - Optional tool calls (each yields start → delta → available)
 * @param thinking - Optional reasoning text
 * @param inputTokens / outputTokens - Usage surfaced via finish messageMetadata
 */
export function makeChatSSEEvents(opts: {
  text?: string;
  toolCalls?: Array<{ id: string; name: string; input: Record<string, unknown> }>;
  thinking?: string;
  inputTokens?: number;
  outputTokens?: number;
}): unknown[] {
  const events: unknown[] = [];

  events.push({ type: 'start' });
  events.push({ type: 'start-step' });

  // Reasoning (thinking) block — hyphenated v7 chunks, delta carries the text.
  if (opts.thinking) {
    const id = 'reasoning-0';
    events.push({ type: 'reasoning-start', id });
    events.push({ type: 'reasoning-delta', id, delta: opts.thinking });
    events.push({ type: 'reasoning-end', id });
  }

  // Text block — `text-delta` carries `delta` (NOT `text`).
  if (opts.text) {
    const id = 'text-0';
    events.push({ type: 'text-start', id });
    events.push({ type: 'text-delta', id, delta: opts.text });
    events.push({ type: 'text-end', id });
  }

  // Tool calls — `tool-input-available` carries the full parsed `input`, so the
  // client executes directly from it (no JSON-string accumulation in v7).
  if (opts.toolCalls) {
    for (const tc of opts.toolCalls) {
      events.push({ type: 'tool-input-start', toolCallId: tc.id, toolName: tc.name });
      events.push({
        type: 'tool-input-delta',
        toolCallId: tc.id,
        inputTextDelta: JSON.stringify(tc.input),
      });
      events.push({
        type: 'tool-input-available',
        toolCallId: tc.id,
        toolName: tc.name,
        input: tc.input,
      });
    }
  }

  events.push({ type: 'finish-step' });

  // Finish — `finishReason` is 'tool-calls' when tools were called, else 'stop'.
  // Usage rides on `messageMetadata`, matching toUIMessageStreamResponse({ messageMetadata }).
  const finishChunk: Record<string, unknown> = {
    type: 'finish',
    finishReason: opts.toolCalls?.length ? 'tool-calls' : 'stop',
  };
  if (opts.inputTokens !== undefined || opts.outputTokens !== undefined) {
    finishChunk.messageMetadata = {
      usage: {
        inputTokens: opts.inputTokens ?? 0,
        outputTokens: opts.outputTokens ?? 0,
      },
    };
  }
  events.push(finishChunk);

  return events;
}
