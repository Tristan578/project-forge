import { describe, it, expect } from 'vitest';
import { matchSpamKeywords, getSpamKeywords } from '../keywords';

describe('keywords', () => {
  describe('matchSpamKeywords', () => {
    it('should not match clean text', () => {
      const result = matchSpamKeywords('Build a platformer with react and interact');
      expect(result.matched).toBe(false);
    });

    it('should match single-word spam keywords', () => {
      const result = matchSpamKeywords('Buy viagra online');
      expect(result.matched).toBe(true);
      expect(result.matches).toContain('viagra');
    });

    it('should match exact "act now" phrase', () => {
      const result = matchSpamKeywords('You should act now!');
      expect(result.matched).toBe(true);
      expect(result.matches).toContain('act now');
    });

    it('should NOT match "react now" for "act now" (PF-457)', () => {
      const result = matchSpamKeywords('react now supports server components');
      expect(result.matched).toBe(false);
    });

    it('should NOT match "interact now" for "act now"', () => {
      const result = matchSpamKeywords('interact now with the game world');
      expect(result.matched).toBe(false);
    });

    it('should match "free money" as exact phrase', () => {
      const result = matchSpamKeywords('Get free money instantly!');
      expect(result.matched).toBe(true);
      expect(result.matches).toContain('free money');
    });

    it('should NOT match "free" alone from "free money"', () => {
      const result = matchSpamKeywords('This game is free to play');
      expect(result.matched).toBe(false);
    });

    it('should match case-insensitively', () => {
      const result = matchSpamKeywords('ACT NOW for a LIMITED OFFER');
      expect(result.matched).toBe(true);
    });

    it('should handle empty string', () => {
      const result = matchSpamKeywords('');
      expect(result.matched).toBe(false);
    });

    it('should match at word boundaries with punctuation', () => {
      const result = matchSpamKeywords('Win at the casino!');
      expect(result.matched).toBe(true);
      expect(result.matches).toContain('casino');
    });
  });

  describe('getSpamKeywords', () => {
    it('should return non-empty lists', () => {
      const { keywords, phrases } = getSpamKeywords();
      expect(keywords.length).toBeGreaterThan(0);
      expect(phrases.length).toBeGreaterThan(0);
    });
  });
});
