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
 * Creates a standard sequence of SSE events simulating a Claude chat turn.
 *
 * @param text - The text content Claude returns
 * @param toolCalls - Optional tool calls to include
 * @param thinking - Optional thinking text
 */
export function makeChatSSEEvents(opts: {
  text?: string;
  toolCalls?: Array<{ id: string; name: string; input: Record<string, unknown> }>;
  thinking?: string;
  inputTokens?: number;
  outputTokens?: number;
}): unknown[] {
  const events: unknown[] = [];

  // Usage: input tokens
  if (opts.inputTokens != null) {
    events.push({ type: 'usage', inputTokens: opts.inputTokens });
  }

  // Thinking
  if (opts.thinking) {
    events.push({ type: 'thinking_start' });
    events.push({ type: 'thinking_delta', text: opts.thinking });
    events.push({ type: 'content_block_stop' });
  }

  // Text content
  if (opts.text) {
    events.push({ type: 'text_delta', text: opts.text });
  }

  // Tool calls
  if (opts.toolCalls) {
    for (const tc of opts.toolCalls) {
      events.push({ type: 'tool_start', id: tc.id, name: tc.name });
      events.push({ type: 'tool_input_delta', json: JSON.stringify(tc.input) });
      events.push({ type: 'content_block_stop' });
    }
  }

  // Usage: output tokens
  if (opts.outputTokens != null) {
    events.push({ type: 'usage', outputTokens: opts.outputTokens });
  }

  // Turn complete
  events.push({
    type: 'turn_complete',
    stop_reason: opts.toolCalls?.length ? 'tool_use' : 'end_turn',
  });

  return events;
}
