import { describe, it, expect } from 'vitest';
import { estimateTokenCount, estimateMessageTokens, formatTokenEstimate } from '../tokenCounter';

describe('tokenCounter', () => {
  describe('estimateTokenCount', () => {
    it('returns 0 for empty string', () => {
      expect(estimateTokenCount('')).toBe(0);
    });

    it('returns 0 for null/undefined-like', () => {
      expect(estimateTokenCount('')).toBe(0);
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
