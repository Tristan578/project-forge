/**
 * Tests for the content moderation filter.
 *
 * Covers severity classification, text cleaning,
 * spam detection, and edge cases.
 *
 * @vitest-environment node
 */

import { describe, it, expect } from 'vitest';
import { moderateContent, shouldBlock, shouldFlag } from '../contentFilter';

describe('contentFilter', () => {
  describe('moderateContent', () => {
    it('should pass clean text', () => {
      const result = moderateContent('This is a great game!');
      expect(result.severity).toBe('pass');
      expect(result.reasons).toHaveLength(0);
      expect(result.cleaned).toBe('This is a great game!');
    });

    it('should pass normal game-related text', () => {
      const result = moderateContent('A fantasy RPG with dragons and magic spells');
      expect(result.severity).toBe('pass');
    });

    it('should flag profanity', () => {
      const result = moderateContent('This game is shit');
      expect(result.severity).toBe('flag');
      expect(result.reasons.length).toBeGreaterThan(0);
    });

    it('should flag strong profanity', () => {
      const result = moderateContent('What the fuck is this');
      expect(result.severity).toBe('flag');
    });

    it('should block severe slurs', () => {
      const result = moderateContent('You are a faggot');
      expect(result.severity).toBe('block');
    });

    it('should block self-harm encouragement', () => {
      const result = moderateContent('go kys');
      expect(result.severity).toBe('block');
    });

    it('should replace flagged words with asterisks', () => {
      const result = moderateContent('This is shit content');
      expect(result.cleaned).not.toContain('shit');
      expect(result.cleaned).toContain('****');
    });

    it('should flag spam patterns - repeated characters', () => {
      const result = moderateContent('aaaaaaaaaa this is spam');
      expect(result.severity).toBe('flag');
      expect(result.reasons).toContain('Potential spam detected');
    });

    it('should flag spam patterns - excessive caps', () => {
      const result = moderateContent('THIS IS ALL CAPS AND VERY LOUD TYPING');
      expect(result.severity).toBe('flag');
      expect(result.reasons).toContain('Potential spam detected');
    });

    it('should flag content with multiple URLs', () => {
      const result = moderateContent('Check https://a.com https://b.com https://c.com');
      expect(result.severity).toBe('flag');
    });

    it('should deduplicate reasons', () => {
      const result = moderateContent('fuck shit');
      const uniqueReasons = new Set(result.reasons);
      expect(result.reasons.length).toBe(uniqueReasons.size);
    });

    it('should handle empty string', () => {
      const result = moderateContent('');
      expect(result.severity).toBe('pass');
      expect(result.cleaned).toBe('');
    });

    it('should handle very long text', () => {
      const longText = 'a'.repeat(10000);
      const result = moderateContent(longText);
      // 10000 'a' chars triggers the repeated char pattern
      expect(result.severity).toBe('flag');
    });

    it('should flag sexual content references', () => {
      const result = moderateContent('This game has nude scenes');
      expect(result.severity).toBe('flag');
    });

    it('should flag hate speech patterns', () => {
      const result = moderateContent('I hate all gamers');
      expect(result.severity).toBe('flag');
    });
  });

  describe('shouldBlock', () => {
    it('should return false for clean text', () => {
      expect(shouldBlock('Great game!')).toBe(false);
    });

    it('should return false for flaggable text', () => {
      expect(shouldBlock('This is shit')).toBe(false);
    });

    it('should return true for blockable text', () => {
      expect(shouldBlock('kys loser')).toBe(true);
    });
  });

  describe('shouldFlag', () => {
    it('should return false for clean text', () => {
      expect(shouldFlag('Great game!')).toBe(false);
    });

    it('should return true for flaggable text', () => {
      expect(shouldFlag('This is shit')).toBe(true);
    });

    it('should return true for blockable text', () => {
      expect(shouldFlag('kys loser')).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle special characters', () => {
      const result = moderateContent('Hello <script>alert("xss")</script>');
      expect(result.severity).toBe('pass');
    });

    it('should handle unicode', () => {
      const result = moderateContent('Great game! 🎮 ✨ ❤️');
      expect(result.severity).toBe('pass');
    });

    it('should handle newlines', () => {
      const result = moderateContent('Line 1\nLine 2\nLine 3');
      expect(result.severity).toBe('pass');
    });

    it('should not flag game-appropriate violence words', () => {
      // Words like "kill" in game contexts should not be flagged
      const result = moderateContent('Kill the dragon to win the game');
      expect(result.severity).toBe('pass');
    });

    it('should not flag "assassin" in game context', () => {
      const result = moderateContent('Play as an assassin in this stealth game');
      expect(result.severity).toBe('pass');
    });
  });
});
