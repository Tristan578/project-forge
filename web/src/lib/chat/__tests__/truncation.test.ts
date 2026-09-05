import { describe, it, expect } from 'vitest';
import { buildTruncatedApiMessages, type ChatMessage } from '@/stores/chatStore';

function makeMessage(role: 'user' | 'assistant', content: string, id?: string): ChatMessage {
  return {
    id: id || `msg_${Math.random()}`,
    role,
    content,
    timestamp: Date.now(),
  };
}

describe('buildTruncatedApiMessages', () => {
  it('returns all messages when within budget', () => {
    const messages: ChatMessage[] = [
      makeMessage('user', 'Hello'),
      makeMessage('assistant', 'Hi there'),
      makeMessage('user', 'How are you?'),
    ];

    const result = buildTruncatedApiMessages(messages, 200000, 1000);
    // Should keep all messages (3 short messages are well within budget)
    expect(result.length).toBe(3);
  });

  it('drops oldest messages when over budget', () => {
    const longText = 'a'.repeat(4000); // ~1000 tokens each
    const messages: ChatMessage[] = [
      makeMessage('user', longText),
      makeMessage('assistant', longText),
      makeMessage('user', longText),
      makeMessage('assistant', longText),
      makeMessage('user', 'final message'),
    ];

    // Very tight budget: only room for ~2 messages
    const result = buildTruncatedApiMessages(messages, 3000, 1000);
    // Should have dropped some messages and added summary marker
    expect(result.length).toBeLessThan(5);
    // Should have a summary marker
    const summaryMsg = result.find(
      (m) => typeof m.content === 'string' && m.content.includes('Earlier conversation summarized')
    );
    expect(summaryMsg).not.toBeUndefined();
    // Should still contain the final message
    const finalMsg = result.find(
      (m) => typeof m.content === 'string' && m.content === 'final message'
    );
    expect(finalMsg).not.toBeUndefined();
  });

  it('drops an assistant message that carried toolCalls like any other message', () => {
    // buildApiMessages emits assistant turns as plain text — a ChatMessage's toolCalls
    // metadata never becomes tool_use/tool_result content blocks — so truncation has no
    // pairs to keep together and drops from the front one message at a time. The
    // previous version of this test looked for orphaned tool_result blocks in output
    // that can never contain any, so it could not fail.
    const longText = 'a'.repeat(8000); // ~2000 tokens each
    const toolTurnText = 'b'.repeat(8000);
    const assistantWithTools: ChatMessage = {
      id: 'msg_tool_asst',
      role: 'assistant',
      content: toolTurnText,
      toolCalls: [
        { id: 'tc_1', name: 'spawn_entity', input: { type: 'cube' }, status: 'success', undoable: true, result: 'ok' },
      ],
      timestamp: Date.now(),
    };

    const messages: ChatMessage[] = [
      makeMessage('user', longText),
      assistantWithTools,
      makeMessage('user', longText),
      makeMessage('assistant', longText),
      makeMessage('user', 'final question'),
    ];

    // Budget fits ~4000 tokens, so at least the first two messages must go.
    const result = buildTruncatedApiMessages(messages, 5000, 1000);

    expect(result.length).toBeGreaterThan(0);
    expect(result.every((m) => typeof m.content === 'string')).toBe(true);
    expect(result.some((m) => m.content === toolTurnText)).toBe(false);
    expect(
      result.some((m) => typeof m.content === 'string' && m.content.includes('Earlier conversation summarized')),
    ).toBe(true);
    const last = result[result.length - 1];
    expect(typeof last.content === 'string' && last.content.includes('final question')).toBe(true);
  });

  it('always keeps the last message', () => {
    const longText = 'a'.repeat(40000); // ~10000 tokens each
    const messages: ChatMessage[] = [
      makeMessage('user', longText),
      makeMessage('assistant', longText),
      makeMessage('user', longText),
      makeMessage('assistant', longText),
      makeMessage('user', 'keep this'),
    ];

    const result = buildTruncatedApiMessages(messages, 5000, 1000);
    const lastMsg = result[result.length - 1];
    // When the last remaining message is a user message, the summary is merged into it
    // to avoid two consecutive user messages. The original content must still be present.
    expect(typeof lastMsg.content === 'string' && lastMsg.content).toContain('keep this');
  });

  it('handles empty messages array', () => {
    const result = buildTruncatedApiMessages([], 200000, 1000);
    expect(result.length).toBe(0);
  });

  it('handles single message', () => {
    const messages: ChatMessage[] = [makeMessage('user', 'Hello')];
    const result = buildTruncatedApiMessages(messages, 200000, 1000);
    expect(result.length).toBe(1);
  });

  it('inserts continuation marker when first remaining message is assistant', () => {
    const longText = 'a'.repeat(40000);
    const messages: ChatMessage[] = [
      makeMessage('user', longText), // will be dropped
      makeMessage('assistant', 'I helped you'), // first remaining
      makeMessage('user', 'thanks'),
    ];

    const result = buildTruncatedApiMessages(messages, 5000, 1000);
    // Should have summary + possibly continuation + remaining messages
    const summaryMsg = result.find(
      (m) => typeof m.content === 'string' && m.content.includes('Earlier conversation summarized')
    );
    expect(summaryMsg).not.toBeUndefined();
  });

  it('filters out system messages', () => {
    const messages: ChatMessage[] = [
      { id: 'sys1', role: 'system', content: 'System note', timestamp: Date.now() },
      makeMessage('user', 'Hello'),
      makeMessage('assistant', 'Hi'),
    ];

    const result = buildTruncatedApiMessages(messages, 200000, 1000);
    const systemMsgs = result.filter((m) => m.role === 'system');
    expect(systemMsgs.length).toBe(0);
  });
});
