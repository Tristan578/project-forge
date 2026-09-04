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
 * The three chunk types the server-side approval gate adds —
 * `tool-approval-request`, `tool-approval-response` and `tool-output-denied`
 * (PF-8860) — live in `makeApprovalRequestSSEEvents` /
 * `makeApprovalResumeSSEEvents` below, with their exact field shapes.
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

/**
 * One turn in which the SERVER gated a destructive tool call (PF-8860).
 *
 * Wire shape of the three chunk types the approval gate introduces, all
 * verified against `ai@7.x`'s `UIMessageChunk` union
 * (`node_modules/ai/dist/index.d.ts`):
 *   - `{ type:'tool-approval-request', approvalId, toolCallId, reason?, isAutomatic?, signature? }`
 *   - `{ type:'tool-approval-response', approvalId, approved, reason?, providerExecuted?, providerMetadata? }`
 *   - `{ type:'tool-output-denied', toolCallId }`
 *
 * A gated call gets NO `tool-output-available` — the SDK blocks it before
 * execution — so the client must resolve its card from the approval-request
 * alone.
 *
 * @param approvalRequestFirst - emit `tool-approval-request` BEFORE
 *   `tool-input-available` for the same toolCallId. The wire gives no ordering
 *   guarantee between the two, so both orders must land on the same state.
 */
export function makeApprovalRequestSSEEvents(opts: {
  toolCallId: string;
  approvalId: string;
  toolName: string;
  input: Record<string, unknown>;
  text?: string;
  /** An additional, ungated call that must execute normally in the same turn. */
  ungatedToolCall?: { id: string; name: string; input: Record<string, unknown> };
  approvalRequestFirst?: boolean;
  /** The HMAC the SDK stamps on the request when a signing secret is set. */
  signature?: string;
  /**
   * Cut the stream immediately after `tool-input-available` — no
   * `tool-approval-request`, no `finish`. This is the real window the SDK
   * leaves open (it emits the input chunk first), and the shape the
   * fail-closed drain in `chatStore` exists for.
   */
  severAfterInput?: boolean;
  inputTokens?: number;
  outputTokens?: number;
}): unknown[] {
  const events: unknown[] = [];
  events.push({ type: 'start' });
  events.push({ type: 'start-step' });

  if (opts.text) {
    events.push({ type: 'text-start', id: 'text-0' });
    events.push({ type: 'text-delta', id: 'text-0', delta: opts.text });
    events.push({ type: 'text-end', id: 'text-0' });
  }

  if (opts.ungatedToolCall) {
    const tc = opts.ungatedToolCall;
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

  events.push({ type: 'tool-input-start', toolCallId: opts.toolCallId, toolName: opts.toolName });
  events.push({
    type: 'tool-input-delta',
    toolCallId: opts.toolCallId,
    inputTextDelta: JSON.stringify(opts.input),
  });

  const approvalRequest: Record<string, unknown> = {
    type: 'tool-approval-request',
    approvalId: opts.approvalId,
    toolCallId: opts.toolCallId,
    ...(opts.signature ? { signature: opts.signature } : {}),
  };
  const inputAvailable = {
    type: 'tool-input-available',
    toolCallId: opts.toolCallId,
    toolName: opts.toolName,
    input: opts.input,
  };
  if (opts.severAfterInput) {
    events.push(inputAvailable);
    return events;
  }
  if (opts.approvalRequestFirst) {
    events.push(approvalRequest, inputAvailable);
  } else {
    events.push(inputAvailable, approvalRequest);
  }

  events.push({ type: 'finish-step' });

  const finishChunk: Record<string, unknown> = { type: 'finish', finishReason: 'tool-calls' };
  if (opts.inputTokens !== undefined || opts.outputTokens !== undefined) {
    finishChunk.messageMetadata = {
      usage: { inputTokens: opts.inputTokens ?? 0, outputTokens: opts.outputTokens ?? 0 },
    };
  }
  events.push(finishChunk);

  return events;
}

/**
 * The turn that comes back after the client resumes with an approval decision.
 *
 * On APPROVE the client has already executed the call and sent its result, so
 * the SDK re-emits nothing for it and the turn is just the model's follow-up
 * text. On DENY the SDK synthesizes an `execution-denied` output and reports it
 * with a `tool-output-denied` chunk — the chunk the ticket never mentions and
 * the reason a denied card would otherwise sit at 'pending' forever.
 */
export function makeApprovalResumeSSEEvents(opts: {
  approvalId: string;
  toolCallId: string;
  approved: boolean;
  text?: string;
  /** Echo the approval-response chunk the SDK sends back. */
  echoResponse?: boolean;
}): unknown[] {
  const events: unknown[] = [];
  events.push({ type: 'start' });
  events.push({ type: 'start-step' });

  if (opts.echoResponse) {
    events.push({
      type: 'tool-approval-response',
      approvalId: opts.approvalId,
      approved: opts.approved,
    });
  }

  if (!opts.approved) {
    events.push({ type: 'tool-output-denied', toolCallId: opts.toolCallId });
  }

  if (opts.text) {
    events.push({ type: 'text-start', id: 'text-1' });
    events.push({ type: 'text-delta', id: 'text-1', delta: opts.text });
    events.push({ type: 'text-end', id: 'text-1' });
  }

  events.push({ type: 'finish-step' });
  events.push({ type: 'finish', finishReason: 'stop' });

  return events;
}
