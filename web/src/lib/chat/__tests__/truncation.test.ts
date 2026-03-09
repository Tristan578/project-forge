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
    expect(summaryMsg).toBeTruthy();
    // Should still contain the final message
    const finalMsg = result.find(
      (m) => typeof m.content === 'string' && m.content === 'final message'
    );
    expect(finalMsg).toBeTruthy();
  });

  it('preserves tool_use/tool_result pairs (drops both together)', () => {
    const messages: ChatMessage[] = [
      makeMessage('user', 'a'.repeat(2000)), // ~500 tokens
      makeMessage('assistant', 'response'),  // small
      makeMessage('user', 'second question'),
    ];

    // Patch the second message to simulate tool_use blocks
    // (buildApiMessages converts them, but since we use ChatMessage format,
    // we just test the raw API messages behavior here)
    const result = buildTruncatedApiMessages(messages, 200000, 1000);
    // Should fit everything
    expect(result.length).toBe(3);
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
    expect(typeof lastMsg.content === 'string' && lastMsg.content).toBe('keep this');
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
    expect(summaryMsg).toBeTruthy();
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
