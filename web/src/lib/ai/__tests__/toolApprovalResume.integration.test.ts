/**
 * PF-8860 — the approval gate and the resume protocol against the REAL AI SDK.
 *
 * Nothing else in the suite runs a real `agent.stream()`: `route.test.ts` mocks
 * `createSpawnforgeAgent` wholesale and the store tests mock `fetch`. That gap
 * is exactly why the previous follow-up format — Anthropic `tool_result` blocks
 * in a `role:'user'` message — shipped and failed silently on the second
 * iteration of every tool-calling turn.
 *
 * These tests deliberately mock NEITHER 'ai' NOR '@/lib/ai/spawnforgeAgent'.
 * They build a ToolLoopAgent with the real AGENT_TOOLS / AGENT_TOOL_APPROVAL
 * and a mock language model, so the SDK's own prompt standardization and
 * approval correlation run for real.
 */

import { describe, it, expect } from 'vitest';
import { ToolLoopAgent, stepCountIs, type ModelMessage } from 'ai';
import { MockLanguageModelV4, simulateReadableStream } from 'ai/test';
import type { LanguageModelV4StreamPart } from '@ai-sdk/provider';
import { AGENT_TOOLS, AGENT_TOOL_APPROVAL } from '@/lib/ai/spawnforgeAgent';

const FINISH: LanguageModelV4StreamPart = {
  type: 'finish',
  finishReason: { unified: 'stop', raw: 'stop' },
  usage: {
    inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 1, text: 1, reasoning: 0 },
  },
};

function textModel(text = 'ok'): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: 'text-start', id: '1' },
          { type: 'text-delta', id: '1', delta: text },
          { type: 'text-end', id: '1' },
          FINISH,
        ],
      }),
    }),
  });
}

/** A model whose first turn calls a tool, and whose later turns answer in text. */
function toolCallingModel(toolName: string, input: Record<string, unknown>): MockLanguageModelV4 {
  let called = false;
  return new MockLanguageModelV4({
    doStream: async () => {
      if (called) {
        return {
          stream: simulateReadableStream({
            chunks: [
              { type: 'text-start', id: '2' },
              { type: 'text-delta', id: '2', delta: 'done' },
              { type: 'text-end', id: '2' },
              FINISH,
            ],
          }),
        };
      }
      called = true;
      return {
        stream: simulateReadableStream({
          chunks: [
            {
              type: 'tool-call',
              toolCallId: 'tc_1',
              toolName,
              input: JSON.stringify(input),
            },
            {
              type: 'finish',
              finishReason: { unified: 'tool-calls', raw: 'tool_use' },
              usage: {
                inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
                outputTokens: { total: 1, text: 1, reasoning: 0 },
              },
            },
          ] as LanguageModelV4StreamPart[],
        }),
      };
    },
  });
}

function makeAgent(model: MockLanguageModelV4) {
  return new ToolLoopAgent({
    id: 'spawnforge-test',
    model,
    instructions: 'test',
    tools: AGENT_TOOLS,
    toolApproval: AGENT_TOOL_APPROVAL,
    stopWhen: stepCountIs(3),
  });
}

/** Drain the stream, returning every part plus any errors it carried. */
async function drain(model: MockLanguageModelV4, messages: ModelMessage[]) {
  const agent = makeAgent(model);
  const parts: Array<Record<string, unknown>> = [];
  const errors: unknown[] = [];
  try {
    const result = await agent.stream({ messages });
    for await (const part of result.fullStream) {
      parts.push(part as unknown as Record<string, unknown>);
      if ((part as { type: string }).type === 'error') {
        errors.push((part as unknown as { error: unknown }).error);
      }
    }
  } catch (err) {
    errors.push(err);
  }
  return { parts, errors };
}

const errorNames = (errors: unknown[]) =>
  errors.map((e) => (e instanceof Error ? `${e.name}: ${e.message}` : String(e)));

/** Drain the UI message stream — the exact chunk shape chatStore parses. */
async function drainUiChunks(model: MockLanguageModelV4, messages: ModelMessage[]) {
  const agent = makeAgent(model);
  const result = await agent.stream({ messages });
  const chunks: Array<Record<string, unknown>> = [];
  for await (const chunk of result.toUIMessageStream()) {
    chunks.push(chunk as unknown as Record<string, unknown>);
  }
  return chunks;
}

describe('tool approval — real SDK', () => {
  it('blocks a destructive tool call with an approval request instead of running it', async () => {
    const { parts, errors } = await drain(
      toolCallingModel('delete_entities', { entityIds: ['1'] }),
      [{ role: 'user', content: 'delete entity 1' }],
    );

    expect(errorNames(errors)).toEqual([]);
    const approvalRequest = parts.find((p) => p.type === 'tool-approval-request');
    expect(approvalRequest, JSON.stringify(parts.map((p) => p.type))).toBeDefined();
    // On `fullStream` the approval request nests the tool call; the UI message
    // stream flattens it to `toolCallId` (asserted separately below). The two
    // shapes differ by design — chatStore only ever sees the flat one.
    expect((approvalRequest?.toolCall as { toolCallId?: string })?.toolCallId).toBe('tc_1');
    expect(typeof approvalRequest?.approvalId).toBe('string');
  });

  it('emits the UI chunk shape the client fixture pins', async () => {
    // Guards `makeApprovalRequestSSEEvents` against SDK drift: if the wire
    // shape ever changes, the fixture chatStore is tested against becomes a
    // lie and this fails instead.
    const chunks = await drainUiChunks(
      toolCallingModel('delete_entities', { entityIds: ['1'] }),
      [{ role: 'user', content: 'delete entity 1' }],
    );

    const request = chunks.find((c) => c.type === 'tool-approval-request');
    expect(request, JSON.stringify(chunks.map((c) => c.type))).toBeDefined();
    expect(request?.toolCallId).toBe('tc_1');
    expect(typeof request?.approvalId).toBe('string');

    // A gated call gets NO tool-output-available — it is blocked before
    // execution, which is why the client resolves its card from the
    // approval-request alone.
    expect(chunks.some((c) => c.type === 'tool-output-available' && c.toolCallId === 'tc_1')).toBe(false);
    expect(chunks.some((c) => c.type === 'tool-input-available' && c.toolCallId === 'tc_1')).toBe(true);
  });

  it("emits a flat 'tool-output-denied' UI chunk on the deny resume", async () => {
    const chunks = await drainUiChunks(textModel('ok'), [
      { role: 'user', content: 'delete entity 1' },
      {
        role: 'assistant',
        content: [
          { type: 'tool-call', toolCallId: 'tc_1', toolName: 'delete_entities', input: { entityIds: ['1'] } },
          { type: 'tool-approval-request', approvalId: 'ap_1', toolCallId: 'tc_1' },
        ],
      },
      { role: 'tool', content: [{ type: 'tool-approval-response', approvalId: 'ap_1', approved: false }] },
    ]);

    expect(chunks.find((c) => c.type === 'tool-output-denied')).toEqual({
      type: 'tool-output-denied',
      toolCallId: 'tc_1',
    });
  });

  it('does NOT block an ordinary scene edit', async () => {
    const { parts, errors } = await drain(
      toolCallingModel('spawn_entity', { entityType: 'cube' }),
      [{ role: 'user', content: 'spawn a cube' }],
    );

    expect(errorNames(errors)).toEqual([]);
    expect(parts.find((p) => p.type === 'tool-approval-request')).toBeUndefined();
  });

  it('correlates an APPROVED resume carrying a client-supplied tool-result', async () => {
    // The ticket's specced approve path (approval-response alone) cannot work:
    // our tools have no `execute`, so the SDK's re-execution returns undefined
    // and appends no result, leaving a dangling tool_use. The client therefore
    // sends the real result alongside the approval-response.
    const { errors } = await drain(textModel('Deleted them.'), [
      { role: 'user', content: 'delete entity 1' },
      {
        role: 'assistant',
        content: [
          { type: 'tool-call', toolCallId: 'tc_1', toolName: 'delete_entities', input: { entityIds: ['1'] } },
          { type: 'tool-approval-request', approvalId: 'ap_1', toolCallId: 'tc_1' },
        ],
      },
      {
        role: 'tool',
        content: [
          { type: 'tool-approval-response', approvalId: 'ap_1', approved: true },
          {
            type: 'tool-result',
            toolCallId: 'tc_1',
            toolName: 'delete_entities',
            output: { type: 'text', value: 'Deleted 1 entity' },
          },
        ],
      },
    ]);

    // No InvalidToolApprovalError / ToolCallNotFoundForApprovalError /
    // InvalidPromptError / MissingToolResultsError.
    expect(errorNames(errors)).toEqual([]);
  });

  it('correlates a DENIED resume and reports tool-output-denied', async () => {
    const { parts, errors } = await drain(textModel('Leaving them alone.'), [
      { role: 'user', content: 'delete entity 1' },
      {
        role: 'assistant',
        content: [
          { type: 'tool-call', toolCallId: 'tc_1', toolName: 'delete_entities', input: { entityIds: ['1'] } },
          { type: 'tool-approval-request', approvalId: 'ap_1', toolCallId: 'tc_1' },
        ],
      },
      {
        role: 'tool',
        content: [{ type: 'tool-approval-response', approvalId: 'ap_1', approved: false }],
      },
    ]);

    expect(errorNames(errors)).toEqual([]);
    // The chunk the ticket never mentions — chatStore has a named case for it.
    expect(parts.some((p) => p.type === 'tool-output-denied')).toBe(true);
  });

  it('rejects an approvalId it never issued (the gate cannot be forged)', async () => {
    const { errors } = await drain(textModel(), [
      { role: 'user', content: 'delete entity 1' },
      {
        role: 'assistant',
        content: [
          { type: 'tool-call', toolCallId: 'tc_1', toolName: 'delete_entities', input: { entityIds: ['1'] } },
        ],
      },
      {
        role: 'tool',
        content: [{ type: 'tool-approval-response', approvalId: 'forged', approved: true }],
      },
    ]);

    expect(errorNames(errors).join(' ')).toContain('InvalidToolApproval');
  });

  it('REGRESSION: the OLD Anthropic-block follow-up is rejected by the SDK', async () => {
    // This is the pre-existing break this ticket sits on top of. It is not
    // hypothetical: it is the exact array chatStore built for every second
    // iteration of a tool-calling turn.
    const { errors } = await drain(textModel(), [
      { role: 'user', content: 'spawn a cube' },
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'tc_1', name: 'spawn_entity', input: {} }],
      } as unknown as ModelMessage,
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'tc_1', content: 'Success', is_error: false }],
      } as unknown as ModelMessage,
    ]);

    expect(errors.length).toBeGreaterThan(0);
    expect(errorNames(errors).join(' ')).toContain('InvalidPrompt');
  });

  it('accepts the new ungated follow-up format', async () => {
    const { errors } = await drain(textModel(), [
      { role: 'user', content: 'spawn a cube' },
      {
        role: 'assistant',
        content: [{ type: 'tool-call', toolCallId: 'tc_1', toolName: 'spawn_entity', input: { entityType: 'cube' } }],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'tc_1',
            toolName: 'spawn_entity',
            output: { type: 'text', value: 'Spawned' },
          },
        ],
      },
    ]);

    expect(errorNames(errors)).toEqual([]);
  });
});
