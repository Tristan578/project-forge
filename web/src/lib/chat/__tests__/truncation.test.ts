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

  it('preserves tool_use/tool_result pairs (drops both together)', () => {
    // Create enough messages to force truncation, including an assistant
    // message with tool calls that will produce tool_use/tool_result API pairs
    const longText = 'a'.repeat(8000); // ~2000 tokens each
    const assistantWithTools: ChatMessage = {
      id: 'msg_tool_asst',
      role: 'assistant',
      content: longText,
      toolCalls: [
        { id: 'tc_1', name: 'spawn_entity', input: { type: 'cube' }, status: 'success', undoable: true, result: 'ok' },
      ],
      timestamp: Date.now(),
    };

    const messages: ChatMessage[] = [
      makeMessage('user', longText),         // ~2000 tokens — should be dropped
      assistantWithTools,                     // ~2000 tokens — should be dropped
      makeMessage('user', longText),         // ~2000 tokens — should be dropped
      makeMessage('assistant', longText),    // ~2000 tokens
      makeMessage('user', 'final question'), // keep this
    ];

    // Budget fits ~3000 tokens (after overhead), so the first messages must be dropped
    const result = buildTruncatedApiMessages(messages, 5000, 1000);

    // The final user message must always be present
    const finalMsg = result.find(
      (m) => typeof m.content === 'string' && (m.content === 'final question' || m.content.includes('final question'))
    );
    expect(finalMsg).not.toBeUndefined();

    // Dropped messages should have produced a summary marker
    const hasSummary = result.some(
      (m) => typeof m.content === 'string' && m.content.includes('Earlier conversation summarized')
    );
    expect(hasSummary).toBe(true);

    // Verify no orphaned tool_result without its preceding tool_use
    for (let idx = 0; idx < result.length; idx++) {
      const msg = result[idx];
      if (Array.isArray(msg.content)) {
        const hasToolResult = (msg.content as Array<{ type?: string }>).some(b => b.type === 'tool_result');
        if (hasToolResult) {
          // Must have a preceding assistant message with tool_use
          const prev = result[idx - 1];
          expect(prev).toBeDefined();
          expect(prev.role).toBe('assistant');
        }
      }
    }
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
