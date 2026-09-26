import { describe, it, expect } from 'vitest';
import { estimateTokenCount, estimateMessageTokens, formatTokenEstimate } from '../tokenCounter';

describe('tokenCounter', () => {
  describe('estimateTokenCount', () => {
    it('returns 0 for empty string', () => {
      expect(estimateTokenCount('')).toBe(0);
    });

    it('returns 0 for null/undefined coerced to falsy', () => {
      // estimateTokenCount guards on falsy input — verify null-like values
      expect(estimateTokenCount(null as unknown as string)).toBe(0);
      expect(estimateTokenCount(undefined as unknown as string)).toBe(0);
    });

    it('estimates ~1 token per 4 chars', () => {
      expect(estimateTokenCount('abcd')).toBe(1);
      expect(estimateTokenCount('abcdefgh')).toBe(2);
    });

    it('rounds up partial tokens', () => {
      expect(estimateTokenCount('ab')).toBe(1); // 2/4 = 0.5 -> ceil = 1
      expect(estimateTokenCount('abcde')).toBe(2); // 5/4 = 1.25 -> ceil = 2
    });

    it('handles longer text', () => {
      const text = 'a'.repeat(400);
      expect(estimateTokenCount(text)).toBe(100);
    });
  });

  describe('estimateMessageTokens', () => {
    it('adds overhead for role', () => {
      const tokens = estimateMessageTokens({ role: 'user', content: '' });
      expect(tokens).toBe(4); // just overhead
    });

    it('estimates string content', () => {
      const tokens = estimateMessageTokens({ role: 'user', content: 'Hello world!' });
      expect(tokens).toBe(4 + 3); // 4 overhead + ceil(12/4)
    });

    it('estimates array content with text blocks', () => {
      const tokens = estimateMessageTokens({
        role: 'assistant',
        content: [
          { type: 'text', text: 'Hello' },
          { type: 'text', text: 'World' },
        ],
      });
      // 4 overhead + ceil(5/4) + ceil(5/4) = 4 + 2 + 2 = 8
      expect(tokens).toBe(8);
    });

    it('estimates tool_use blocks', () => {
      const tokens = estimateMessageTokens({
        role: 'assistant',
        content: [
          { type: 'tool_use', name: 'spawn_entity', input: { type: 'cube' } },
        ],
      });
      // 4 overhead + tokens for name + tokens for JSON
      expect(tokens).toBeGreaterThan(4);
    });

    it('estimates tool_result blocks', () => {
      const tokens = estimateMessageTokens({
        role: 'user',
        content: [
          { type: 'tool_result', content: 'Success: entity spawned' },
        ],
      });
      expect(tokens).toBeGreaterThan(4);
    });

    it.each([
      ['a number', 0],
      ['false', false],
    ])('counts a malformed tool_use block (%s in every field) like an empty one (#9565)', (_label, bad) => {
      const empty = estimateMessageTokens({ role: 'assistant', content: [{ type: 'tool_use', name: '', input: {} }] });
      const malformed = estimateMessageTokens({ role: 'assistant', content: [{ type: 'tool_use', name: bad, input: bad }] });
      expect(malformed).toBe(empty);
    });

    // A truthy non-string name: `0` and `false` above cannot tell the name
    // guard from `String(b.name || '')`, which also maps them to ''.
    it('counts a non-string tool_use name like an empty one (#9565)', () => {
      const empty = estimateMessageTokens({ role: 'assistant', content: [{ type: 'tool_use', name: '', input: {} }] });
      const numericName = estimateMessageTokens({ role: 'assistant', content: [{ type: 'tool_use', name: 123456789012, input: {} }] });
      expect(numericName).toBe(empty);
    });

    it('counts a non-object tool_use input like an empty object (#9565)', () => {
      const empty = estimateMessageTokens({ role: 'assistant', content: [{ type: 'tool_use', name: 'n', input: {} }] });
      const stringInput = estimateMessageTokens({ role: 'assistant', content: [{ type: 'tool_use', name: 'n', input: 'x'.repeat(40) }] });
      expect(stringInput).toBe(empty);
    });

    it.each([
      ['a number', 0],
      ['false', false],
    ])('counts a malformed tool_result body (%s) as empty (#9565)', (_label, bad) => {
      const empty = estimateMessageTokens({ role: 'user', content: [{ type: 'tool_result', content: '' }] });
      const malformed = estimateMessageTokens({ role: 'user', content: [{ type: 'tool_result', content: bad }] });
      expect(malformed).toBe(empty);
    });

    it('counts an array tool_result body by its content, not as "[object Object]" (#9565)', () => {
      const long = 'x'.repeat(400);
      const tokens = estimateMessageTokens({ role: 'user', content: [{ type: 'tool_result', content: [{ type: 'text', text: long }] }] });
      expect(tokens).toBeGreaterThan(100);
    });

    it('estimates image blocks at ~1600 tokens', () => {
      const tokens = estimateMessageTokens({
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', data: 'abc' } },
        ],
      });
      expect(tokens).toBe(4 + 1600);
    });
  });

  describe('formatTokenEstimate', () => {
    it('formats small numbers without k suffix', () => {
      expect(formatTokenEstimate(500)).toBe('~500');
    });

    it('formats thousands with k suffix', () => {
      expect(formatTokenEstimate(1500)).toBe('~1.5k');
    });

    it('formats exact thousands', () => {
      expect(formatTokenEstimate(2000)).toBe('~2.0k');
    });

    it('formats large numbers', () => {
      expect(formatTokenEstimate(150000)).toBe('~150.0k');
    });
  });
});
